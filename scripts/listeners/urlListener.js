'use strict';

const scriptInfo = {
    name: 'urlListener',
    file: 'urlListener.js',
    desc: 'Listen for URLS, append them to a DB table, clean them if they expire, and other stuff including pulling proper meta data',
    createdBy: 'Dave Richer'
};

const c = require('irc-colors');
const _ = require('lodash');
const xray = require('x-ray')();
const GoogleUrl = require('google-url');
const moment = require('moment');
const HashMap = require('hashmap');
const Models = require('bookshelf-model-loader');
const helpers = require('../../helpers');
const conLogger = require('../../lib/consoleLogger');
const rp = require('request-promise-native');

/**
  Translate urls into Google short URLS
  Listeners: shorten
  Npm Requires: google-url
**/
module.exports = app => {
        // Google API Key required
        if (!app.Config.apiKeys.google) {
            return;
        }

        const cronTime = '00 01 * * *';

        // Ignore the users entirely
        const userIgnore = app.Config.features.urls.userIgnore || [];

        // Ignore URL logging for specific channels
        const urlLoggerIgnore = app.Config.features.urls.loggingIgnore || [];

        // Anounce Ignore
        const announceIgnore = app.Config.features.urls.announceIgnore || [];

        // Google API
        const googleUrl = new GoogleUrl({
            key: app.Config.apiKeys.google
        });

        // Cache URLS to prevent unnecessary API calls
        const urlCache = new HashMap();

        // Send To Pusher
        const pusher = (url, to, from, results) => {
            return new Promise((resolve, reject) => {
                // Load in pusher if it is active
                if (!app.Config.pusher.enabled && !app._pusher) {
                    resolve(results);
                    return;
                }
                // Decide which pusher channel to push over
                let channel = /\.(gif|jpg|jpeg|tiff|png)$/i.test(url) ? 'image' : 'url';
                // Grab a timestamp
                let timestamp = Date.now();
                // Prepare Output
                let output = {
                    url,
                    to,
                    from,
                    timestamp,
                    // If this is a youtube video, use the vide title rather then the title
                    title: (!_.isUndefined(results.youTube) && results.youTube.videoTitle) ? results.youTube.videoTitle : results.title || ''
                };
                // Include an ID if we have one
                if (results.id) {
                    output.id = results.id;
                }
                // Include a ShortUrl if we have one
                if (results.shortUrl) {
                    output.shortUrl = results.shortUrl;
                }

                // Set output to Pusher
                app._pusher.trigger('public', channel, output);

                // Append results
                results.delivered.push({
                    protocol: 'pusher',
                    to: channel,
                    on: timestamp
                });

                resolve(results);
            });
        };

        // Log Urls to the Database
        const logInDb = (url, to, from, message, results) => {
            let ignored = urlLoggerIgnore.some(hash => {
                if (_.includes(hash, _.toLower(to))) {
                    return true;
                }
            });
            if (!app.Database || !Models.Url || ignored) {
                resolve(results);
                return;
            }
            return new Promise((resolve, reject) => {
                    // Log the URL
                    return Models.Url.create({
                            url: url,
                            to: to,
                            from: from,
                            title: results.title
                        })
                        .then(record => {
                            results.id = record.id;
                            results.delivered.push({
                                protocol: 'urlDatabase',
                                on: Date.now()
                            });
                            resolve(results);
                        })
                        .catch((err) => {
                            resolve(results);
                        });
                })
                .then(results => {
                    return new Promise((resolve, reject) => {
                        // Log Youtube Url
                        if (!_.isUndefined(results.youTube)) {
                            return Models.YouTubeLink.create({
                                    url: url,
                                    to: to,
                                    from: from,
                                    title: results.youTube.videoTitle,
                                    user: message.user,
                                    host: message.host
                                })
                                .then(record => {
                                    results.delivered.push({
                                        protocol: 'youTubeDatabase',
                                        on: Date.now()
                                    });
                                    resolve(results);
                                })
                                .catch((err) => {
                                    resolve(results);
                                });
                        } else {
                            resolve(results);
                        }
                    });
                });
        };

        // Begin the chain
        const startChain = url => new Promise((resolve, reject) => {
            if (!url) {
                reject({
                    message: 'A URL is required'
                });
                return;
            }
            resolve({
                url,
                delivered: [],
                secure: url.startsWith('https://'),
            });
        });

        // Shorten the URL
        const shorten = (url, results) => new Promise((resolve, reject) => {
            // Check input / Gate
            if (url.startsWith('http://goo.gl/') || url.startsWith('https://goo.gl/')) {
                resolve(results);
                return;
            }
            if (urlCache.has(url)) {
                resolve(_.merge(results, {
                    shortUrl: urlCache.get(url)
                }));
                return;
            }
            googleUrl.shorten(url, (err, shortUrl) => {
                if (err) {
                    resolve(results);
                    return;
                }
                urlCache.set(url, shortUrl);
                resolve(_.merge(results, {
                    shortUrl
                }));
            });
        });

        // Get the title
        const getTitle = (url, results) => new Promise((resolve, reject) => {
            xray(url, 'title')((err, title) => {
                if (err || !title) {
                    resolve(results);
                    return;
                }
                resolve(_.merge(results, {
                    title: helpers.StripNewLine(_.trim(title))
                }));
            });
        });

        // Get GitHub Information
        const getGitHub = (url, domain, user, repo, results) => rp({
                uri: `https://api.github.com/repos/${user}/${repo}`,
                headers: {
                    'user-agent': 'MrNodeBot'
                }
            })
            .then(result => {
                let data = JSON.parse(result);
                if (!data) {
                    return getTitle(url, results);
                }
                // Format The response
                results.gitHub = {
                    name: data.name,
                    owner: data.owner.login,
                    desc: data.description,
                    isFork: data.fork,
                    lastPush: data.pushed_at,
                    stars: data.stargazers_count,
                    watchers: data.watchers_count,
                    language: data.language,
                    forks: data.forks_count,
                    issues: data.open_issues_count,
                    fullName: data.full_name,
                };
                return results;
            })
            .catch(err => {
                return getTitle(url, results)
            });

        const getRepoInfo = (url, domain, user, repo, results) => {
            // Bail if we have no result, default back to getTitle
            if (_.isEmpty(url, domain, user, repo)) {
                return getTitle(url, results);
            }

            switch (domain.toLowerCase()) {
                case 'github.com':
                    return getGitHub(url, domain, user, repo, results);
                    break;
                case 'bitbucket.org':
                    // TODO Implement BitBucket
                    return getTitle(url, results);
                    break;
                default:
                    return getTitle(url, results);
                    break;
            }
        };


        // Get the youtube key from link
        const getYoutube = (url, key, results) => new Promise((resolve, reject) => {
            // Bail if we have no result
            if (!key || _.isEmpty(key)) {
                resolve(results);
                return;
            }
            return rp({
                    uri: 'https://www.googleapis.com/youtube/v3/videos',
                    qs: {
                        id: key,
                        key: app.Config.apiKeys.google,
                        fields: 'items(id,snippet(channelId,title,categoryId),statistics)',
                        part: 'snippet,statistics'
                    }
                })
                .then(result => {
                    let data = JSON.parse(result).items[0];
                    // We have no data, default back to the original title grabber
                    if (!data) {
                        return getTitle(url, results)
                    }
                    let videoTitle = data.snippet.title || '';
                    let viewCount = data.statistics.viewCount || 0;
                    let likeCount = data.statistics.likeCount || 0;
                    let dislikeCount = data.statistics.dislikeCount || 0;
                    let commentCount = data.statistics.commentCount || 0;
                    resolve(_.merge(results, {
                        youTube: {
                            videoTitle,
                            viewCount,
                            likeCount,
                            dislikeCount,
                            commentCount
                        }
                    }));
                });
        });

        const logos = {
            youTube: c.grey.bold('You') + c.red.bold('Tube'),
            gitHub: c.grey.bold('GitHub')
        };

        const icons = {
            upArrow: c.green.bold('↑'),
            downArrow: c.red.bold('↓'),
            views: c.navy.bold('⚘'),
            comments: c.blue.bold('✍'),
            sideArrow: c.grey.bold('→'),
            anchor: c.navy.bold('⚓'),
            star: c.yellow.bold('*'),
            happy: c.green.bold('☺'),
            sad: c.red.bold('☹')
        }

        // Formatting Helper
        const shortSay = (to, from, payload) => {
                let output = '';
                let space = () => output == '' ? '' : ' ';

                // We have a Short URL
                if (payload.shortUrl && payload.url.length > app.Config.features.urls.titleMin) {
                    output = output + `${icons.anchor} ${c.navy(payload.shortUrl)} ${icons.sideArrow}`;
                }
                // We have a Title
                if (payload.title && payload.title != '') {
                    output = output + space() + payload.title;
                }

                // We have a YouTube video response
                if (!_.isUndefined(payload.youTube)) {
                    let yr = payload.youTube;
                    output = output + space() + `${logos.youTube} ${icons.sideArrow} ${yr.videoTitle} ${icons.views} ` +
                        `${c.navy(yr.viewCount)} ${icons.upArrow} ${c.green(yr.likeCount)} ${icons.downArrow} ${c.red(yr.dislikeCount)}` +
                        ` ${icons.comments} ${c.blue(yr.commentCount)}`;
                }

                // We Have GitHub data
                if (!_.isUndefined(payload.gitHub)) {
                    let gh = payload.gitHub;
                    let lastUpdate = '~ ' + moment(gh.lastPush).fromNow();
                    output = output + space() + `${logos.gitHub} ${icons.sideArrow} ${gh.owner} ${icons.sideArrow} ${gh.name} ${icons.sideArrow} ${gh.desc} ${gh.isFork ? '*fork*' : ''} ${icons.sideArrow} ${c.bold('Updated:')} ${lastUpdate} ${icons.sideArrow} ${gh.language} ${icons.sideArrow} ${icons.star} ${c.yellow(gh.stars)} ` +
                        `${icons.views} ${c.navy.bold(gh.watchers)} ${gh.forks ? c.bold(`Forks: `)  + gh.forks : ''}${icons.sad} ${c.red(gh.issues)}`;
        }

        if (output != '') {
            app.say(to, `${from} ${icons.sideArrow} ` + output);
        }
    };

    // Report back to IRC
    const say = (to, from, results) =>
        new Promise((resolve, reject) => {
            if (!_.includes(announceIgnore, to)) {
                shortSay(to, from, results);
                results.delivered.push({
                    protocol: 'irc',
                    to: to,
                    on: Date.now()
                });
            }
            resolve(results);
        });

    // Handle Errors
    const handleErrors = err => {
        if (err.message || err.inner) {
            console.log(err.message, err.inner);
        }
    };

    // Handler
    const listener = (to, from, text, message) => {
        // Check to see if the user is ignored from url listening, good for bots that repete
        if (_.includes(userIgnore, from)) return;

        // Get Urls
        let urls = helpers.ExtractUrls(text);

        // Input does not contain urls
        if (!urls) return;

        _(urls)
            // We do not deal with FTP
            .filter(url => !url.startsWith('ftp'))
            .each(url =>
                startChain(url)
                // Process
                .then(results => shorten(url, results))
                .then(results => {
                    // Check for youTube
                    let ytMatch = url.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
                    // If We have a valid Youtube Link
                    if (ytMatch && ytMatch[2].length == 11) {
                        return getYoutube(url, ytMatch[2], results);
                    }

                    // Check for GitHub or BitBucket
                    let gitMatch = url.match(/(?:git@(?![\w\.]+@)|https:\/{2}|http:\/{2})([\w\.@]+)[\/:]([\w,\-,\_]+)\/([\w,\-,\_]+)(?:\.git)?\/?/);
                    // Match 1: Domain, Match 2: User Group3: Repo
                    if (gitMatch && gitMatch[1] && gitMatch[2] && gitMatch[3]) {
                        return getRepoInfo(url, gitMatch[1], gitMatch[2], gitMatch[3], results);
                    }
                    // If we have a regular link
                    return getTitle(url, results)
                })
                .then(results => say(to, from, results))
                // Report
                .then(results => logInDb(url, to, from, message, results))
                .then(results => pusher(url, to, from, results))
                .catch(handleErrors)
            );
    };

    // URL Info
    const urlInfo = (to, from, text, message) => {};

    // List for urls
    app.Listeners.set('url-listener', {
        desc: 'Listen for URLS',
        call: listener
    });

    // Clear cache every hour
    app.schedule('cleanUrls', cronTime, () => {
        conLogger('Clearing Google Short URL Cache', 'info');
        urlCache.clear();
    });


    // Return the script info
    return scriptInfo;
};
