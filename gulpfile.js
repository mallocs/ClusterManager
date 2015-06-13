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
      .pipe(source('clustermanager.min.js'))
      .pipe(buffer())
      .pipe($.sourcemaps.init({ loadMaps: true }))
        // Add transformation tasks to the pipeline here.
        .pipe($.uglify())
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


gulp.task('clean', require('del').bind(null, ['.tmp', 'dist']));

gulp.task('serve', function () {
  browserSync({
    notify: false,
    port: 9000,
    server: {
      baseDir: ['.tmp', 'test'],
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






//gulp.task('build', ['jshint'], function () {
//  return gulp.src('dist/**/*').pipe($.size({title: 'build', gzip: true}));
//});

/*****

gulp.task('default', ['clean'], function () {
  gulp.start('build');
});

gulp.task('browserify', function () {
  var browserified = transform(function(filename) {
    var b = browserify(filename);
    return b.bundle();
  });
  return gulp.src(['./src/*.js'])
    .pipe(browserified)
    .pipe(gulp.dest('./dist'));
});


gulp.task('javascript', function () {
  // set up the browserify instance on a task basis
  var b = browserify({
    entries: './entry.js',
    debug: true
  });

  return b.bundle()
    .pipe(source('app.js'))
    .pipe(buffer())
    .pipe(gulp.dest(DEST))
    .pipe($.sourcemaps.init({loadMaps: true}))
        // Add transformation tasks to the pipeline here.
        .pipe($.uglify())
        .on('error', gutil.log)
    .pipe($.sourcemaps.write('./'))
    .pipe($.rename({ extname: '.min.js' }))
    .pipe(gulp.dest(DESTINATION));
});

gulp.task('default', function() {
  return gulp.src('foo.js')
    // This will output the non-minified version
    .pipe(gulp.dest(DEST))
    // This will minify and rename to foo.min.js
    .pipe($.uglify())
    .pipe($.rename({ extname: '.min.js' }))
    .pipe(gulp.dest(DEST));
});
*******/
