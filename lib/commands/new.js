/*
 * @fileOverview
 * @author: Mike Grabowski (@grabbou)
 */

'use strict';

var Task = require('../tasks/install-from-repo');
var program = require('commander');
var _ = require('lodash');

function createNewProject() {
  var task = new Task();
  var args = _.dropRight(arguments, 1);
  task.start(args, this.opts());
}

program
  .command('new <name> [dest]')
  .alias('n')
  .option('-k, --keep-git', 'Keeps Este.js git instance, creates new one otherwise')
  .option('-v, --verbose', 'Prints NPM output to process.stdout')
  .description('Creates new Este.js project')
  .action(createNewProject);