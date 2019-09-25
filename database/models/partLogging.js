const Models = require("funsociety-bookshelf-model-loader");

const PartLogging = Models.Base.extend({
    tableName: "partLogging",
    hasTimestamps: ["timestamp"],
    soft: false,
    requireFetch: false
});

module.exports = {
    PartLogging: Models.Bookshelf.model("partLogging", PartLogging)
};
