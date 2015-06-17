/*global -$ */
'use strict';
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var browserSync = require('browser-sync');
var reload = browserSync.reload;
var browserify = require('browserify');
var watchify = require('watchify');
var babel = require('babelify');
var transform = require('vinyl-transform');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');

var DESTINATION = './dist/';

function compile(watch) {
  var bundler = browserify('./src/ClusterManager.js', { debug: true }).transform(babel);
    if (watch) {
        bundler = watchify(bundler);
    }
 
  function rebundle() {
    bundler.bundle()
      .on('error', function(err) { console.error(err); this.emit('end'); })
      .pipe(source('clustermanager.js'))
      .pipe(buffer())
      .pipe(gulp.dest(DESTINATION))
      .pipe($.sourcemaps.init({ loadMaps: true }))
      .pipe($.uglify())
      .pipe($.rename('clustermanager.min.js'))
      .pipe($.sourcemaps.write('./'))
      .pipe(gulp.dest(DESTINATION));  
  }
 
  if (watch) {
    bundler.on('update', function() {
      console.log('-> bundling...');
      rebundle();
    });
  }
 
  rebundle();
}
 
function watch() {
  return compile(true);
}
 
gulp.task('compile', ['clean', 'jshint'], function() { return compile(); });
gulp.task('watch', function() { return watch(); });


gulp.task('jshint', function () {
  return gulp.src('src/**/*.js')
    .pipe(reload({stream: true, once: true}))
    .pipe($.jshint())
    .pipe($.jshint.reporter('jshint-stylish'))
    .pipe($.if(!browserSync.active, $.jshint.reporter('fail')));
});

gulp.task('clean', require('del').bind(null, ['dist']));

gulp.task('serve', function () {
  browserSync({
    notify: false,
    port: 9000,
    server: {
      baseDir: ['test'],
      routes: {
        '/src': 'src',
        '/dist': 'dist',
        '/bower_components': 'bower_components'
      }
    }
  });

  // watch for changes
  gulp.watch([
    'src/*'
  ]).on('change', reload);
});


gulp.task('serve:dist', function () {
  $.connect.server({
    root: 'demos',
    port: 9001
  });
});
