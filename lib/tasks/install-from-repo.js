/*
 * @fileOverview
 * @author: Mike Grabowski (@grabbou)
 */

'use strict';

var assert = require('assert');
var chalk = require('chalk');
var exec = require('child-process-promise').exec;
var fs = require('fs');
var Promise = require('bluebird');
var path = require('path');
var rimraf = require('rimraf');
var Task = require('../models/task');
var mkdirp = require('mkdirp');

var PROCESS_COMMAND = 'npm info postinstall';
var PROCESS_COMMAND_REGEXP = new RegExp('^' + PROCESS_COMMAND + ' ([^\r@]+)@.+$');
var APP_MODULE = 'este-app';

module.exports = Task.extend({

  repoLink: 'https://github.com/steida/este',

  // By default tasks only run within Este project
  skipEsteCheck: true,

  _run: function runTask(passedArguments, passedOptions) {

    var name = passedArguments[0];
    var dest = passedArguments[1];

    var options = this._options = {
      name: name,
      dest: path.resolve(dest || './' + name)
    };

    var dependencies = [];

    var _this = this;

    return this._ensureEmptyFolder(options.dest)
      .then(function() {
        console.log(chalk.bold.white('1/6. Cloning repository...'));
        return _this._cloneRepo();
      })
      .tap(function goToFolder() {
        console.log(chalk.bold.white('2/6. Going to newly created project...'));
        process.chdir(options.dest);
      })
      .then(function reinitialiseGit() {
        if (!passedOptions.keepGit) {
          console.log(chalk.bold.white('3/6. Reinitialising repository...'));
          return _this._deleteGitFolder()
            .then(_this._initGit.bind(_this))
            .then(_this._initialCommit.bind(_this))
        } else {
          console.log(chalk.bold.white('3/6. Using Este.js repository...'));
        }
      })
      .then(function() {
        console.log(chalk.bold.white('4/6. Reading list of dependencies...'));

        var npmDependencies = _this._npmDependencies();
        var reply = '';

        npmDependencies.progress(function(childProcess) {
          childProcess.stdout.on('data', function(data) {
            reply += data.toString();
          });
        });

        return Promise.resolve(npmDependencies)
          .tap(function() {
            // trim() - remove last empty line
            // split('\n') - split to separate lines
            // slice(1) - remove first line containing application path
            // map - keep just the name of module's directory (dependency name)
            _this.dependencies = reply.trim().split('\n').slice(1).map(
              function(line) {
                return line.split(/[\/\\]/).slice(-1)[0];
              });
          });
      })
      .then(function() {
        var installation = _this._npmInstall();
        var deps = _this.dependencies.slice();
        var total = deps.length;

        var reply = '';
        var lines = [];
        var processed = [];
        var enableStdOut = false;
        var barCount = 0;

        // Display NPM log in verbose mode, show spinner otherwise
        if (passedOptions.verbose) {
          installation.progress(function(childProcess) {
            childProcess.stdout.on('data', function(data) {
              process.stdout.write(chalk.bold.green('[NPM] ') + chalk.dim(data.toString()));
            });
          });
        } else {
          process.stdout.write(chalk.bold.white('5/6. Installing npm dependencies: ')
            + chalk.white(Array(31).join('░'))); // 30 empty bars

          installation.progress(function(childProcess) {
            childProcess.stderr.on('data', function(data) {

              // collect stderr output and search lines for processed dependencies
              reply += data.toString();

              if (~reply.indexOf('\n')) {
                lines = reply.split('\n');
                reply = lines.pop();   

                lines.forEach(function(line) {
                  var dependency;
                  var position;

                  if ((dependency = PROCESS_COMMAND_REGEXP.exec(line)) && (dependency = dependency[1])) {
                    if (dependency == APP_MODULE) {
                      // log information about the postinstall process of APP_MODULE
                      process.stdout.write(chalk.bold.white('\n6/6. Running ' + APP_MODULE + ' postinstall...\n'));
                    } else if (~(position = deps.indexOf(dependency))) {
                      // move dependency from deps array to processed array
                      processed.push(deps.splice(position, 1));

                      if (barCount < Math.round(30 * processed.length / total)) {
                        // modify the progressbar if barCount changes
                        barCount = Math.round(30 * processed.length / total);
                        // 30 backspaces + 30 progress dependent bars
                        process.stdout.write(Array(31).join('\b') + chalk.bold.green(Array(barCount + 1).join('▒')) + chalk.white(Array(31 - barCount).join('░'))); 
                      }                      
                    }
                  }
                });
              }
            });
          });
        }

        return Promise.resolve(installation);
      })
      .then(this._npmDedupe.bind(this));

  },

  /**
   * Makes sure task does not override another directory
   * @private
   * @method ensureEmptyFolder
   * @param folder
   * @returns {Promise}
   */
  _ensureEmptyFolder: function ensureEmptyFolder(folder) {
    return new Promise(function(resolve, reject) {
      fs.exists(folder, function(err, exists) {
        if (err || exists) return reject(new Error('Folder ' + folder + ' already exists. Please choose different one'));
        resolve();
      })
    });
  },

  /**
   * Clones repo to destination folder
   * @private
   * @method cloneRepo
   * @returns {Promise}
   */
  _cloneRepo: function cloneRepo() {
    return exec(
      'git clone --depth=1 ' + this.repoLink + ' ' + this._options.dest
    );
  },

  /**
   * Deletes current git
   * @private
   * @method deleteGitFolder
   * @returns {Promise}
   */
  _deleteGitFolder: function deleteGitFolder() {
    var dest = this._options.dest;
    return new Promise(function(resolve, reject) {
      rimraf(dest + '/.git', function(err, data) {
        if (err) return reject(err);
        resolve(data);
      })
    });
  },

  /**
   * Creates new git
   * @private
   * @method initGit
   * @returns {Promise}
   */
  _initGit: function initGit() {
    return exec('git init');
  },

  /**
   * Creates initial commit on master branch
   * @private
   * @method initalCommit
   * @returns Promise
   */
  _initialCommit: function initialCommit() {
    return exec('git add . && git commit -m "Initial commit"');
  },

  /**
   * Installs dependencies
   * @private
   * @method npmInstall
   * @returns {Promise}
   */
  _npmInstall: function npmInstall() {
    return exec('npm install --loglevel=info', {maxBuffer: 8 * 1024 * 1024});
  },

  /**
   * Optimises directory structure
   * @private
   * @method npmDedupe
   * @returns {Promise}
   */
  _npmDedupe: function npmDedupe() {
    return exec('npm dedupe react');
  },

  /**
   * Gets npm dependencies
   * @private
   * @method npmDependencies
   * @returns {Promise}
   */
  _npmDependencies: function npmDependencies() {
    return exec('npm ls --depth=0 --parseable --loglevel=silent || true');
  }

});