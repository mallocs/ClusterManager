
var FS = require('fs');

desc('This is the default task.');
task('default', ['demos', 'src', 'docs', 'minify'], function (params) {
  console.log('This is the default task.');
});

desc('Download new source');
task('src', function() {
    console.log("Downloading new source");
    var cmd = 'curl http://zope2.ocnewsmap.com/ocnewsmap/ocr/clusterer/v3/clustermanager.js -o clustermanager.js';
    jake.exec([cmd], {printStdout: true}, function() {
        console.log("Finished downloading");
        complete();
    });
});

desc('Minify');
task('minify', function() {
    console.log("Minifying");
    var cmd = 'uglifyjs clustermanager.js -o clustermanager.min.js';
    jake.exec([cmd], {printStdout: true}, function() {
        console.log("Finished minifying");
        complete();
    });
});

desc('Generate documentation.');
task('docs', function(){
        console.log("Writing documentation");
        var path = '../jsdoc_toolkit-2.4.0';
        var cmd = 'java -jar ' + path + '/jsrun.jar ' +
            path + '/app/run.js ' + './clustermanager.js -d=docs/ ' +
            '-t=' + path + '/templates/jsdoc/';
        jake.exec([cmd], {printStdout: true}, function () {
            console.log("Finished writing documentation");
            complete();
        });
});

desc('Copy demos');
task('demos', function() {
    console.log("Writing demos");
    var demosURL = "http://zope2.ocnewsmap.com/ocnewsmap/ocr/clusterer/v3/demos/";
    var demos = ['simple.html', 'complex.html', 'functions.html', 'speed_test.html',
                 'speed_test.js', 'data.json'];
    var cmds = [];
    for(var i=0, demo; demo=demos[i]; i++) {
        var cmd = 'curl ' + demosURL + demo + ' -o ' + 'demos/' + demo;
        cmds.push(cmd);
    }
    jake.exec(cmds, {printStdout: true}, function () {
        console.log("Finished writing demos");
        complete();
    });
});
