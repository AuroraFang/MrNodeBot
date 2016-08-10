/**
Greet the users in #fsociety
TODO: Make multi-channel and configurable
**/
'use strict';

const _ = require('lodash');

// More readable inline leet speak
const l33t = text => text
    .replace('a', '4')
    .replace('b', '6')
    .replace('e', '3')
    .replace('s', '$')
    .replace('i', '1')
    .replace('t', '7')
    .replace('o', '0');

module.exports = app => {
    const salutations = _.map([
        'Greetings', 'Hail', 'Welcome', 'Salutations', 'Alhoa',
        'Howdy', 'Hi', 'Hey', 'Hiya', 'Good Day', 'Yo', 'How are you', 'Salute', 'What\'s up', 'Bonsoir'
    ], l33t);

    const appends = _.map([
        'hello friend', 'it\'s happening', 'what are your instructions', 'I saved a chair for you'
    ], l33t);

    // Model
    const greetModel = app.Models.get('greeter');
    // Check DB to see if they were already greeted
    const checkChannel = (channel, nick, callback) => {
        new greetModel().query(qb => {
                qb.where('channel', 'like', channel)
                    .andWhere('nick', 'like', nick);
            })
            .fetch()
            .then(results => {
                // Does not exist
                if (!results) {
                    // Logg that we have greeted for this channel
                    new greetModel({
                        channel: channel,
                        nick: nick
                    }).save().catch(err => {
                        console.log(err.message);
                    });
                    if (typeof(callback) === typeof(Function)) {
                        callback();
                    }
                }
            });
    };

    const onJoin = (channel, nick, message) => {
        // Make sure we are not reporting ourselves
        if (nick !== app.Bot.nick && channel === app.Config.features.darkArmy.mainChannel) {
            checkChannel(channel, nick, () => {
                setTimeout(() => {
                    let greeting = app.random.pick(app.randomEngine, salutations);
                    let append = app.random.pick(app.randomEngine, appends);
                    app.Bot.say(nick, `${greeting} ${nick}, ${append}.`);
                }, app.Config.features.darkArmy.greeterDealy * 1000);
            });
        }
    };

    const cleanGreetDb = (to, from, text, message) => {
        if (!text) {
            app.Bot.say(from, 'You must specifiy a channel when clearing the greeter cache');
            return;
        }
        let channel = text.getFirst();
        new greetModel()
            .where('channel', 'like', channel)
            .destroy()
            .then(() => {
                app.Bot.say(from, `Greet cache has been cleared for ${channel}`);
            })
            .catch(err => {
                app.Bot.say(from, `Something went wrong clearing the greet cache for ${channel}`);
                console.log(err.message);
            });
    };

    const getTotalGreetedByChannel = (to, from, text, message) => {
        if(!text) {
            app.Bot.say(from, 'You must specifiy a channel when clearing the greeter cache');
            return;
        }
        let channel = text.getFirst();
        new greetModel()
            .where('channel', 'like', channel)
            .count()
            .then(total => {
                app.Bot.say(from, `A total of ${total} greets have been sent out for the channel ${channel}`);
            })
            .catch(err => {
                app.Bot.say(from, `Something went wrong fetching the greet total for ${channel}`);
                console.log(err);
            });
    };

    // Provide a onjoin handler
    app.OnJoin.set('fsociety-greeter', {
        call: onJoin,
        name: 'fsociety-greetr'
    });

    //Clear greet cache
    app.Commands.set('greet-clear-channel', {
        desc: 'greet-clear-channel [channel] - Clear the greet cache for  the specified channel',
        access: app.Config.accessLevels.owner,
        call: cleanGreetDb
    });

    // Get total greets by channel
    app.Commands.set('greet-total-channel', {
        desc: 'greet-total-channel [channel] - Get the total amount of greets for the specified channel',
        access: app.Config.accessLevels.owner,
        call: getTotalGreetedByChannel
    });

};
