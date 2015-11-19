"use strict";
var async = require("async");
var JsonapiStoreRelationalDb = require("..");
var instances = [ ];

// Replace the MemoryStore default handler with our own version
require("jsonapi-server/lib/MemoryHandler");
module.children[2].exports = function() {
  var dbStore = new JsonapiStoreRelationalDb({
    dialect: "mysql",
    host: "localhost",
    port: 3306,
    username: "root",
    password: null,
    logging: console.log
  });

  // Keep the handler around for after the test rig is live
  instances.push(dbStore);
  return dbStore;
};

var jsonApiTestServer = require("jsonapi-server/example/server.js");
jsonApiTestServer.start();

// MySQL doesn't differentiate between undefined and null.
// Tweak the created field to allow null fields to pass Joi validation.
var articles = require("jsonapi-server")._resources.articles;
articles.attributes.created = articles.attributes.created.allow(null);
articles.onCreate.created = articles.onCreate.created.allow(null);

// Before starting the test suite, load all example resouces, aka
// the test fixtures, into the databases
async.map(instances, function(dbStore, callback) {
  dbStore.populate(callback);
}, function() { });
