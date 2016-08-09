'use strict';

const gitlog = require('gitlog');
const helpers = require('../../helpers');

/**
  Review the local git change log ( Last 5 commits )
  Commands: changes
**/
module.exports = app => {
    const changes = (to, from, text, message) => {
        gitlog(app.Config.gitLog, function(error, commits) {

            // Exit on error
            if (error) {
                app.Bot.say(from, helpers.TitleLine(
                    'Something has gone wrong retrieving the change log'
                ));
                return;
            }

            app.Bot.say(from, helpers.TitleLine(
                `${app.Bot.nick} Change log, last ${app.Bot.nick} changes:`
            ));

            app.Bot.say(from, helpers.RedSlashes(
                'Hash / Author / Subject / Date'
            ));

            // List the commits
            commits.forEach(commit => {
                app.Bot.say(from, helpers.RedSlashes(
                    `${commit.abbrevHash} / ${commit.authorName} / ${commit.subject} / ${commit.authorDateRel}`));
            });

            // Last commit link
            if (commits && commits[0]) {
                app.Bot.say(from, `Last Commit: ${app.Config.project.repository.url}/commit/${commits[0].abbrevHash}`);
            }
        });
    };

    app.Commands.set('changes', {
        desc: 'Review the bots change log',
        access: app.Config.accessLevels.guest,
        call: changes
    });
};
