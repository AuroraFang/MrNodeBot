const scriptInfo = {
    name: 'Image Upload Web Front End',
    desc: 'Provides a PUG form for uploading photos',
    createdBy: 'IronY',
};
const path = require('path');
const logger = require('../../lib/logger');
const Models = require('funsociety-bookshelf-model-loader');
const randToken = require('rand-token');

module.exports = (app) => {
    // Log nick changes in the alias table
    if (!app.Database && !Models.Token) return;

    // Show the form upload
    const uploadForm = (req, res) => res.render('upload');

    // Process the upload
    const uploadHandler = async (req, res) => {
        // Validation

        // Invalid Token
        if (!req.body.token) {
            res.status(500).send('No token was specified');
            return;
        }

        // Invalid File
        if (!req.files || !req.files.image) {
            res.status(500).send('No images were specified');
            return;
        }

        // Invalid File MIME type
        if (!req.files.image.mimetype.startsWith('image/')) {
            res.status(500).send('Improper MIME type');
            return;
        }

        // Hold Values
        const file = req.files.image;
        const token = req.body.token;
        const nsfw = req.body.nsfw || false;

        try {
            const tResults = await Models.Token.where('token', token).fetch();

            if (!tResults) {
                res.status(500).send('Something went wrong fetching your results');
                return;
            }

            // Build the new filename
            const fileName = `${randToken.generate(6)}${path.extname(file.name)}`;

            // Move the image to the uploads dir
            file.mv(`${app.AppRoot}/web/uploads/${fileName}`, async (err) => {
                // if something went wrong, return
                if (err) {
                    logger.error('Something went wrong moving an image in the imageUploadWeb script', {
                        message: err.message || '',
                        stack: err.stack || '',
                    });
                    res.status(500).send('Something went wrong with the image upload');
                    return;
                }

                // Build URL Path
                const urlPath = `${app.Config.express.address}/uploads/${fileName}`;

                // Add the Url to the database
                if (Models.Url) {
                    try {
                        await Models.Url.create({
                            url: urlPath,
                            to: tResults.get('channel'),
                            from: tResults.get('user'),
                        });
                    } catch (innerErr) {
                        logger.error('Something went wrong saving a URL model inside imageUploadWeb', {
                            message: err.message || '',
                            stack: err.stack || '',
                        });
                    }
                }

                // Respond on IRC
                const msg = `${tResults.get('user')} just uploaded: ${urlPath} ${nsfw ? '(NSFW)' : ''}`.trim();
                app.say(tResults.get('channel'), msg);

                // Respond on Web
                res.redirect(app.WebServer.namedRoutes.build('urls', {
                    channel: tResults.get('channel'),
                    user: tResults.get('user'),
                }));
            });
        } catch (err) {
            res.status(500).send('Internal server error');
        }
    };

    // Register upload Form
    app.WebRoutes.set('uploadForm', {
        handler: uploadForm,
        desc: 'Upload a file',
        path: '/upload',
        verb: 'get',
    });

    // Register upload Handler
    app.WebRoutes.set('uploadHandler', {
        handler: uploadHandler,
        desc: 'Handle File Upload',
        path: '/upload',
        verb: 'post',
    });

    // Return the script info
    return scriptInfo;
};
