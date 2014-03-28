var path = require('path');
var fs = require('fs');
var http = require('http');

var mkdirp = require('mkdirp');

var duster = require("../../duster");


/**
 * TextOut Middleware.
 *
 * Performs variable and token substitution on some text files that find themselves being served.
 * This includes any HTML file and the gitana.js driver.
 */
exports = module.exports = function(basePath)
{
    var areServerTagsEnabled = function(configuration)
    {
        var enabled = false;

        if (configuration && configuration.serverTags)
        {
            if (typeof(configuration.serverTags.enabled) != "undefined")
            {
                enabled = configuration.serverTags.enabled;
            }
        }

        return enabled;
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // RESULTING OBJECT
    //
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////

    var r = {};

    r.interceptor = function(configuration)
    {
        return function(req, res, next)
        {
            // wrap the res.render function
            // this allows us to peek at HTML that flows back and plug in additional tags

            var _sendfile = res.sendfile;
            var _send = res.send;

            res.sendfile = function(filePath, options, fn)
            {
                var filename = path.basename(filePath);

                var parsable = false;
                if (areServerTagsEnabled(configuration))
                {
                    if (filePath.indexOf(".html") !== -1)
                    {
                        parsable = true;
                    }
                }

                // if it's something we can parse...
                if (parsable)
                {
                    // path to the html file
                    var fullFilePath = filePath;
                    if (options.root) {
                        fullFilePath = path.join(options.root, fullFilePath);
                    }

                    var t1 = new Date().getTime();
                    duster.execute(req, fullFilePath, function(err, out) {

                        var t2 = new Date().getTime();
                        console.log("Dust time: " + (t2-t1));

                        if (err)
                        {
                            // use the original method
                            _sendfile.call(res, filePath, options, fn);
                        }
                        else
                        {
                            _send.call(res, 200, out);
                        }
                    });
                }

                // if they request "gitana.js", we plug in client key info
                else if (filename == "gitana.js" || filename == "gitana.min.js")
                {
                    // check for the "gitana.json" file
                    // either in process root or in virtual host path
                    //var gitanaJsonPath = path.join(process.cwd(), "gitana.json");
                    var gitanaJsonPath = "./gitana.json";
                    if (req.virtualHostGitanaJsonPath)
                    {
                        gitanaJsonPath = req.virtualHostGitanaJsonPath;
                    }
                    else if (process.env.CLOUDCMS_GITANA_JSON_PATH)
                    {
                        gitanaJsonPath = process.env.CLOUDCMS_GITANA_JSON_PATH;
                    }

                    //console.log("Gitana JSON Path: " + gitanaJsonPath);

                    fs.readFile(gitanaJsonPath, function(err, text) {

                        if (err)
                        {
                            // hand back 404
                            res.send(404);
                            return;
                        }

                        // parse
                        var json = JSON.parse(text);
                        if (json.clientKey)
                        {
                            if (options.root) {
                                filePath = path.join(options.root, filePath);
                            }
                            fs.readFile(filePath, function(err, text) {

                                if (err)
                                {
                                    fn(err);
                                    return;
                                }

                                text = "" + text;

                                var ick = "Gitana.__INSERT_MARKER = null;";

                                var i1 = text.indexOf(ick);
                                if (i1 > -1)
                                {
                                    var i2 = i1 + ick.length;

                                    var config = {
                                        "clientKey": json.clientKey
                                    };
                                    // NO, this does not get handed back
                                    // FOR NOW, hand back because the Apache proxy doesn't auto-insert and we're still
                                    // using it for /console
                                    //if (json.clientSecret) {
                                    //    config.clientSecret = json.clientSecret;
                                    //}
                                    if (json.application) {
                                        config.application = json.application;
                                    }

                                    // append in the default config settings
                                    var itext = "";
                                    itext += "/** INSERTED BY CLOUDCMS-NET SERVER **/";
                                    itext += "Gitana.autoConfigUri = false;";
                                    itext += "Gitana.loadDefaultConfig = function() {";
                                    itext += "   return " + JSON.stringify(config, null, "   ") + ";";;
                                    itext += "};";
                                    itext += "/** END INSERTED BY CLOUDCMS-NET SERVER **/";

                                    text = text.substring(0, i1) + itext + text.substring(i2);
                                }

                                //res.send(200, html);
                                _send.call(res, 200, text);

                                fn();
                            });
                        }
                        else
                        {
                            fn({
                                "message": "Missing json clientKey in gitana config"
                            });
                            return;
                        }
                    });
                }
                else
                {
                    // BUG: there appears to be an issue with Express whereby an empty file returns a 503
                    // we want it to return a 200
                    // so here we check for file size
                    var fullFilePath = filePath;
                    if (options.root) {
                        fullFilePath = path.join(options.root, fullFilePath);
                    }
                    fullFilePath = path.normalize(fullFilePath);
                    var exists = fs.existsSync(fullFilePath);
                    if (!exists)
                    {
                        res.send(404);
                        return;
                    }
                    var stats = fs.statSync(fullFilePath);
                    if (stats.size == 0)
                    {
                        res.send(200, "");
                        return;
                    }

                    // use the original method
                    return _sendfile.call(res, filePath, options, fn);
                }
            };

            next();
        };
    };

    return r;
};
