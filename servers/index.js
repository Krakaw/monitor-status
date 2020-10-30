const glob = require('glob')
    , path = require('path');

let checks = [];
glob.sync('./servers/**/*.js').forEach(function (file) {
    if (file.indexOf('./servers/index.js') > -1) {
        return
    }
    const items = require(path.resolve(file));
    checks = checks.concat(items);
});
module.exports= checks;
