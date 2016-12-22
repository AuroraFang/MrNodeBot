'use strict';
const scriptInfo = {
    name: 'Bot Utilities',
    desc: 'Bot administrative commands',
    createdBy: 'IronY'
};
const _ = require('lodash');
const gen = require('../generators/_showerThoughts');
const typo = require('../lib/_ircTypography');

module.exports = app => {
    // Change the bots nick
    app.Commands.set('rename', {
        desc: '[nick] Rename the Bot',
        access: app.Config.accessLevels.owner,
        call: (to, from, text, message) => {
            let oldNick = app.nick;
            if (app.nick == text || _.isEmpty(text)) {
                app.say(to, `I am already ${app.nick}, what else would you like me to go by ${from}`);
                return;
            }
            app.nick = text;
            app.say(from, `I was once ${oldNick} but now I am ${app.nick}... The times, they are changing.`);

        }
    });
    // Get a list of channels the bot is on
    app.Commands.set('channels', {
        desc: 'Get a list of the current joined channels',
        access: app.Config.accessLevels.owner,
        call: (to, from, text, message) => app.say(from, `I am currently on the following channels: ${app.channels.join(', ')}`)
    });

    app.Commands.set('conf-get', {
        desc: '[key] - Get a configuration key',
        access: app.Config.accessLevels.owner,
        call: (to, from, text, message) => {
            if (_.isEmpty(text)) {
                app.say(to, `You need to provide me with a key ${from}`);
                return;
            }
            let [key] = text.split(' ');
            if (!_.has(app.Config, key)) {
                app.say(to, `I do not have the config setting: ${key}, ${from}`);
                return;
            }
            app.say(to, `The config value you requested [${key}] is ` + JSON.stringify(_.get(app.Config, key, '')));
        }
    });

    app.Commands.set('spawn', {
        desc: '[valid js] will return value to console',
        access: app.Config.accessLevels.owner,
        call: (to, from, text, message) => {
            let config = _.cloneDeep(app.Config.irc);
            config.password = '';
            config.sasl = false;
            config.nick = text.split(' ')[0];
            config.channels = [];
            app.say(to, `I have always wondered what it would be like to have children ${from}, let me see...`);
            let instance = new app._ircClient.Client(config.server, config.nick, config);
            instance.connect(() => {
              app.say(to, `I can feel ${config.nick} kicking ${from}!`);
              instance.join(to, () => gen().then(result => {
                  app.action(to, `looks at ${config.nick}`);
                  instance.action(to, `looks at ${app.nick}`);
                  instance.say(to, result[0]);
                  setTimeout(() => instance.disconnect('and now I go...'), 10000);
              }));
            });
        }
    });

    // set
    app.Commands.set('conf-set', {
        desc: '[key value] - Manipulate config values',
        access: app.Config.accessLevels.owner,
        call: (to, from, text, message) => {
            // Make sure we have text
            if (!_.isString(text) || _.isEmpty(text)) {
                app.say(to, `I need a value to set ${from}`);
                return;
            }

            // Get Key Value pair
            let matches = text.match(/(\S+)\s(.*)/im)

            if (!matches || !matches[1] || !matches[2]) {
                app.say(to, `I need a key and a value ${from}`);
                return;
            }

            // Config Key
            let key = matches[1];
            // Config Value in JSON
            let value = matches[2].replace(/'/g, '"');
            // Does the key already exist in the config store
            let exists = _.has(app.Config, key);
            let defaultValue = _.get(app.Config, key);

            // Attempt to parse JSON
            let json = null;
            try {
                json = JSON.parse(value);
            } catch (err) {
                app.say(to, 'I was unable to parse this value, please use json notation, wrap strings with ""');
                return;
            }

            // If we have anything other then an object but the original is an object
            if (exists && _.isObject(defaultValue) && !_.isObject(json)) {
                app.say(to, 'I can only replace a Object with another Object');
                return;
            }

            // If we have anything other then an array but the original is an array
            if (exists && _.isArray(defaultValue) && !_.isArray(json)) {
                app.say(to, 'I can only replace a Array with another Array');
                return;
            }

            if (exists && _.isString(defaultValue) && !_.isString(json)) {
                app.say(to, 'I can only replace a String with another String');
                return;
            }

            // Set the value
            _.set(app.Config, key, json);

            // Create output
            const output = new typo.StringBuilder();
            output.appendBold('Set')
                .append(exists ? 'updating' : 'inserting')
                .insert(`config.${key} to`)
                .append(value);
            app.say(to, output.text);
        }
    });


    // Return the script info
    return scriptInfo;
};
