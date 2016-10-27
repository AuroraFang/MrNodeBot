'use strict';

const _ = require('lodash');
const Models = require('bookshelf-model-loader');
const moment = require('moment');

module.exports = (channel, thresh, app, options) => new Promise((resolve, reject) => {
    if (!app.isInChannel(channel)) {
        resolve(`I am not in the channel ${channel}`)
        return;
    }

    options = options || {};
    if(_.isUndefined(options.timeUnit)) options.timeUnit = 1;
    if(_.isUndefined(options.timeMeasure)) options.timeMeasure = 'months';

    return Models.Logging
        .query(qb => qb
            .where(clause =>
              clause
              .where('to', 'like', channel)
              .andWhere('timestamp','>=', moment().subtract(options.timeUnit, options.timeMeasure).format('YYYY-MM-DD HH:mm:ss'))
            )
            .orderBy('id', 'desc')
        )
        .fetchAll()
        .then(results => {
            if (!app.isInChannel(channel) || !app._ircClient.isOpInChannel(channel)) {
                resolve(`I am not in, or I am not an op in ${channel}`);
                return;
            }
            _(results.toJSON())
                .groupBy('from')
                .filter((v, k) => app.isInChannel(channel, k) && !app._ircClient.isOpOrVoiceInChannel(channel, k))
                .mapKeys(v => _.first(v).from)
                .mapValues(v => v.length)
                .map((count, nick) => {
                    if (count >= thresh) return nick
                })
                .chunk(4)
                .each((v, k) => {
                  console.log(v,k);
                    setTimeout(() => app._ircClient.send('MODE', channel, '+' + 'v'.repeat(v.length), v[0], v[1] || '', v[2] || '', v[3] || ''), (1 + k) * 1000);
                });
            resolve(`Voices ${thresh} users on ${channel}`);
        });
});
