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
var Spinner = require('cli-spinner').Spinner;
var Task = require('../models/task');
var mkdirp = require('mkdirp');

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

    var _this = this;

    return this._ensureEmptyFolder(options.dest)
      .then(function() {
        console.log(chalk.blue('1/4. Cloning repository...'));
        return _this._cloneRepo();
      })
      .tap(function goToFolder() {
        console.log(chalk.blue('2/4. Going to newly created project...'));
        process.chdir(options.dest);
      })
      .then(function reinitialiseGit() {
        if (!passedOptions.keepGit) {
          console.log(chalk.blue('3/4. Reinitialising repository...'));
          return _this._deleteGitFolder()
            .then(_this._initGit.bind(_this))
            .then(_this._initialCommit.bind(_this))
        } else {
          console.log(chalk.blue('3/4. Using Este.js repository...'));
        }
      })
      .then(function() {
        var spinner = new Spinner('%s');
        var installation = _this._npmInstall();

        // Display NPM log in verbose mode, show spinner otherwise
        if (passedOptions.verbose) {
          installation.progress(function(childProcess) {
            childProcess.stdout.on('data', function(data) {
              process.stdout.write(chalk.bold.green('[NPM] ') + chalk.dim(data.toString()));
            });
          });
        } else {
          spinner.setSpinnerString('|/-\\');
          spinner.start();
        }

        console.log(chalk.blue('4/4. Installing npm dependencies...'));

        return Promise.resolve(installation)
          .tap(function() {
            spinner.stop();
          });
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
    return exec('npm install');
  },

  /**
   * Optimises directory structure
   * @private
   * @method npmDedupe
   * @returns {Promise}
   */
  _npmDedupe: function npmDedupe() {
    return exec('npm dedupe react');
  }

});