/*
 * @fileOverview
 * @author: Mike Grabowski (@grabbou)
 */

'use strict';

var assert = require('assert');
var chalk = require('chalk');
var exec = require('child-process-promise').exec;
var Promise = require('bluebird');
var Task = require('../models/task');

/**
 * Regexp of searched log line in "npm install -loglevel=info" on stderr
 * for tagging the dependency as 'processed', we use the active group
 * in regexp to extract the name of postinstalled dependency
 * @const {RegExp}
 */
var PROCESS_COMMAND_REGEXP = new RegExp('^npm info postinstall ([^\r@]+)@.+$');

/**
 * @const {Object}
 */
var DEFAULT_OPTIONS = {
  // last of PROCESS_COMMAND_REGEXP matches like "npm info postinstall este-app@x.x.x"
  appModule: 'este-app',
  // the progress bar length
  barLength: 40,
  // chalk styles for the progress bar and logged text
  chalkStylesBar: ['white'],
  chalkStylesProcessed: ['bold', 'green'],
  chalkStylesText: ['bold', 'white'],
  // messages for logged output
  messageRead: 'Reading list of dependencies...',
  messageInstall: 'Installing npm dependencies:',
  messagePostInstall: 'Running Este.js postinstall...',
  // index and subtasks count to provide better logged output with steps like "3/5. Installing..."
  subtaskIndex: 0,
  totalSubtasks: 0
};

module.exports = Task.extend({

  _run: function runTask(passedOptions) {

    // merge passedOptions with the defaults, sanitize keys of passedOptions 
    var options = this._mergeOptions(DEFAULT_OPTIONS, passedOptions);

    // set chalk styles based on provided options for use in output logging
    var chalkBar = this._getStyledChalk(options.chalkStylesBar);
    var chalkProcessed = this._getStyledChalk(options.chalkStylesProcessed);
    var chalkText = this._getStyledChalk(options.chalkStylesText);

    // helper for outputing text like "currentTask/totalTasks. "
    var stepText = function(increment) {
      if (!options.totalSubtasks) {
        return '';
      }

      return (options.subtaskIndex + increment) + '/' + options.totalSubtasks + '. ';
    };

    var _this = this;

    // log message about start of reading attempt
    console.log(chalkText(stepText(0) + options.messageRead));

    return this._getNpmDependenciesPaths()
      .then(function(paths) {
        return _this._parsePathString(paths);
      })
      .then(function(dependencies) {
        var installation = _this._npmInstall();

        // deps found in one searching step of logBuffer parsing
        var foundDeps = [];
        // deps of foundDeps in given step, which are listed in 'depencencies' input
        var processedDeps = [];
        // all deps, which were already processed in any step
        var finishedDeps = [];

        // whole lines of logBugffer (ending '\n')
        var finishedLines = [];
        // buffer for collecting of incoming data
        var logBuffer = '';

        // contains state of progress bar for optimized redrawing
        var progressBarState = {
          redraw: false,
          done: 0
        };
        // for storing builded text parts of progress bar
        var progressBarTexts = {};
        
        // print install message and empty progress bar to stdout and stay on the same line
        process.stdout.write(chalkText(stepText(1) + options.messageInstall + ' ')
          + chalkBar(_this._buildProgressBarTexts(options.barLength, 0).tail));

        installation.progress(function(childProcess) {
          childProcess.stderr.on('data', function(data) {
            // collect stderr output
            logBuffer += data.toString();

            // if there is no '\n' in the buffer then skip to more reading
            if (!~logBuffer.indexOf('\n')) {
              return;
            }

            // split the buffer to lines
            finishedLines = logBuffer.split('\n');

            // remove last (unfinished) line from the finishedLines and put it back to buffer
            logBuffer = finishedLines.pop();   

            // find lines matching the PROCESS_COMMAND_REGEXP and extract dependency names
            foundDeps = _this._getFoundDependencies(finishedLines);

            // if no dependencies are found then just skip to more reading to buffer
            if (!foundDeps) {
              return;
            }

            // get just those dependencies, which are listed in 'dependencies' input
            processedDeps = foundDeps.filter(function(dep) {
              return ~dependencies.indexOf(dep);
            });
            
            if (processedDeps) {
              // add processed deps to finished
              finishedDeps = finishedDeps.concat(processedDeps);
              // and calculate new progress bar state 
              progressBarState = _this._calculateProgressBarState(
                options.barLength,
                progressBarState.done,
                finishedDeps.length,
                dependencies.length);
            }

            if (progressBarState.redraw) {
              // get the texts for progress bar
              progressBarTexts = _this._buildProgressBarTexts(options.barLength, progressBarState.done);
              // delete previous bar, print new via predefined styling functions and stay on the same line
              process.stdout.write(
                progressBarTexts.del +
                chalkProcessed(progressBarTexts.done) +
                chalkBar(progressBarTexts.tail)); 
              // disable further redrawing, until new changes occur
              progressBarState.redraw = false;
            }
            
            /**
             * Last postinstall is runned on the app-module, so print the info about last installation subtask
             */
            if (~foundDeps.indexOf(options.appModule)) {
              process.stdout.write(chalkText('\n' + stepText(2) + options.messagePostInstall + '\n'));
            }
          });
        });

        return Promise.resolve(installation);
      });
  },

  /**
   * Builds the texts for printing the progress bar
   * @private
   * @method buildProgressBarTexts
   * @param barLength {number} requested length of the progress bar
   * @param done {number} length of text of 'done' bars
   * @returns {Object} countaining "del", "done" and "tail" texts of progress bar
   */
  _buildProgressBarTexts: function buildProgressBarTexts(barLength, done) {
    return {
      del: Array(barLength + 1).join('\b'),
      done: Array(done + 1).join('▒'),
      tail: Array(barLength + 1 - done).join('░')
    };
  },

  /**
   * Calculates if given amount of finished deps would lead to redraw of the progress bar
   * @private
   * @method calculateProgressBarState
   * @param barLength {number} requested length of the progress bar
   * @param previous {number} result of calculation on previous state
   * @param finishedDepsCount {number} number of already finished dependencies
   * @param totalDepsCount {number} number of all watched dependencies
   * @returns {Object} countaining "redraw" flag and "done" with current value
   */
  _calculateProgressBarState: function calculateProgressBarState(barLength, previous, finishedDepsCount, totalDepsCount) {
    var current = Math.round(barLength * finishedDepsCount / totalDepsCount);

    return {
      redraw: current != previous,
      done: current
    };
  },

  /**
   * Scans the list of lines from stderr for pattern PROCESS_COMMAND_REGEXP and extracts
   * dependency names into an array
   * @private
   * @method getFoundDependencies
   * @param lines {Array<string>} list of lines of "npm install -loglevel=info" stderr
   * @returns {Array<string>}
   */
  _getFoundDependencies: function getFoundDependencies(lines) {
    var regExpMatch = [];
    var deps = [];

    if (!lines) {      
      return deps;
    }

    lines.forEach(
      function(line) {

        // find lines matching 'processed command' pattern and extract dependency name
        if (!(regExpMatch = PROCESS_COMMAND_REGEXP.exec(line))) {          
          return;
        }
        
        // add to the array first matched group (dependency name), it's on index 1
        deps.push(regExpMatch[1]);
      });

    return deps;
  },

  /**
   * Gets stdout output with path list of npm dependencies
   * @private
   * @method getNpmDependenciesPaths
   * @returns {Promise}
   */
  _getNpmDependenciesPaths: function getNpmDependenciesPaths() {
    // start npm ls command to get the paths of dependencies
    var npmDependenciesPaths = this._npmDependenciesPaths();
    // buffer for collecting data from stdout of childProcess
    var paths = '';

    npmDependencies.progress(function(childProcess) {
      childProcess.stdout.on('data', function(data) {
        paths += data.toString();
      });
    });

    return Promise.resolve(npmDependencies)
      .tap(function() {
        return Promise.resolve(paths)
      });
  },

  /**
   * Builds partially applied chalk function with passed styles
   * @private
   * @method getStyledChalk
   * @param chalkStyles {Array<string>} list of valid styles ['white', 'bgBlue', 'bold']
   * @returns {function(string)}
   */
  _getStyledChalk: function getStyledChalk(chalkStyles) {
    var styledChalk = chalk;
    
    if (!chalkStyles) {      
      return styledChalk;
    }

    chalkStyles.forEach(
      function(chalkStyle) {
        styledChalk = styledChalk.chalk[chalkStyle];
      });

    return styledChalk;
  },

  /**
   * Marges 2 objects, while sanitizing the output based on the structure of 1st one
   * @private
   * @method mergeOptions
   * @param defaults {Object} set of valid keys with default values
   * @param options {?Object} just valid keys in defaults are replaced from options
   * @returns {Object}
   */
  _mergeOptions: function mergeOptions(defaults, options) {
    var merged = {};
    
    if (!options) {      
      return defaults;
    }

    defaults.keys().forEach(
      function(key) {
        merged[key] = options[key] || defaults[key];
      });

    return merged;
  },

  /**
   * Gets top level npm dependencies, while suppresing all errors, which always
   * appear because of not installed packages
   * @private
   * @method npmDependenciesPaths
   * @returns {Promise}
   */
  _npmDependenciesPaths: function npmDependenciesPaths() {
    return exec('npm ls --depth=0 --parseable --loglevel=silent || true');
  },

  /**
   * Installs dependencies with verbose logging of actions:
   *  - enable logging level "info" to parse stderr for processed dependencies
   *  - set maximum buffer size to something reasonable like 8 MB
   *    (about 1.5 MB is needed for 100 top level dependencies)
   * @private
   * @method npmLoggedInstall
   * @returns {Promise}
   */
  _npmLoggedInstall: function npmLoggedInstall() {
    return exec('npm install --loglevel=info', {maxBuffer: 8 * 1024 * 1024});
  },

  /**
   * Parses the string output of npm ls to get array of dependency names
   *  - trim() => remove last empty line
   *  - split('\n') => split to separate lines
   *  - slice(1) => remove first line containing application path
   *  - map => keep just the name of module's directory (dependency name)
   * @private
   * @method parsePathString
   * @param pathString {string}
   * @returns {Promise}
   */
  _parsePathString: function parsePathString(pathString) {
    return Promise.resolve(pathString.trim().split('\n').slice(1).map(
      function(line) {
        return line.split(/[\/\\]/).pop();
      }));
  }

});