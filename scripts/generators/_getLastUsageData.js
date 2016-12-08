'use strict';
const _ = require('lodash');
const Models = require('bookshelf-model-loader');
const extract = require('../../lib/extractNickUserIdent');
const logger = require('../../lib/logger');
const Moment = require('moment');


module.exports = text => new Promise((res, rej) => {
    // Gate
    if (!Models.Logging || !Models.JoinLogging || !Models.PartLogging || !Models.QuitLogging || !Models.KickLogging || !Models.Alias) return rej(new Error('No Database available'));
    if (_.isUndefined(text) || !_.isString(text) || _.isEmpty(text)) return rej(new Error('No input available'));

    // Extract user information
    let args = extract(text);

    // Grab user
    let nick = args.nick;
    let user = args.user;
    let host = args.host;

    // GATES

    // We have no user
    if (!nick && !user && !host) return rej(new Error('No results available'));

    // Query filter
    const filter = (qb, nickField = 'nick', userField = 'user') => {
        if (nick) qb.andWhere(nickField, 'like', nick);
        if (user) qb.andWhere(userField, 'like', user);
        if (host) qb.andWhere('host', 'like', host);
        return qb.orderBy('timestamp', 'desc').limit(1);
    };

    // Render object
    const render = (result, key) => {
        if (!result || !key) return;
        let output = Object.create(null);
        output[key] = result.toJSON();
        return output;
    };

    // Tabulate results
    const tabulateResults = results => {
        // Invalid Results
        if (!_.isArray(results) || _.isEmpty(results)) return [];
        // Remove undefined / falsey values
        results = _.compact(results);
        return {
            finalResults: results, // Filtered version of total results
            lastSaid: _(results).map('log').compact().first(), // Last Said information
            lastAction: _(results).maxBy(value => Moment(value[Object.keys(value)[0]].timestamp).unix()) // Last Action information
        };
    };

    // Resolve all the queries, process the results, report any errors
    return Promise.all([
            Models.Logging.query(qb => filter(qb, 'from', 'ident')).fetch().then(result => render(result, 'log')),
            Models.JoinLogging.query(filter).fetch().then(result => render(result, 'join')),
            Models.PartLogging.query(filter).fetch().then(result => render(result, 'part')),
            Models.QuitLogging.query(filter).fetch().then(result => render(result, 'quit')),
            Models.KickLogging.query(filter).fetch().then(result => render(result, 'kick')),
            Models.Alias.query(qb => filter(qb, 'oldnick')).fetch().then(result => render(result, 'aliasOld')),
            // Models.Alias.query(qb => filter(qb, 'newnick')).fetch().then(result => render(result, 'aliasNew')),
        ])
        .then(tabulateResults)
        .then(sendToIRC)
        .catch(err => {
            logger.error('Error in the last active Promise.all chain', {
                err
            });
            return rej({
                args: args,
                inner: err.message,
            });
        });

});
