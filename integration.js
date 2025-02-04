'use strict';

const async = require('async');
const { Pool } = require('pg');

let _pool;
let poolSignature = '';
let Logger;
let summaryMap = [];
let detailsMap = [];

function getPool(options) {
  let optionString = options.host + options.user + options.port + options.password + options.database;
  if (poolSignature != optionString) {
    poolSignature = optionString;

    _pool = new Pool({
      connectionLimit: 10,
      host: options.host,
      user: options.user,
      port: options.port,
      password: options.password,
      database: options.database
    });
  }

  return _pool;
}

/**
 * Takes the attribute option string which is a comma delimited list of attributes to display and converts
 * it into an object of the format:
 * ```
 * {
 *     label: <attribute label>,
 *     column: <attribute name>,
 *     type: <attribute type>
 * }
 * ```
 * The label is optional and is the display label to be used for the attribute.  If no label is provided then the
 * column name is used
 *
 * The column is the name of the returned column in the query
 *
 * The type is the type of data and can change display behavior.  Currently supports 'link' which causes the
 * template to display the data as a clickable link.
 *
 * @param attributeOption
 * @returns {*}
 */
function processAttributeOption(attributeOption) {
  if (attributeOption.trim().length === 0) {
    return [];
  }

  const fields = attributeOption.split(',').map((column) => {
    const tokens = column.split(':');
    if (tokens.length === 1) {
      return {
        column: tokens[0].trim(),
        label: tokens[0].trim(),
        type: null
      };
    } else if (tokens.length === 2) {
      return {
        column: tokens[0].trim(),
        label: tokens[1].trim(),
        type: null
      };
    } else if (tokens.length === 3) {
      return {
        column: tokens[0].trim(),
        label: tokens[1].trim(),
        type: tokens[2].trim().toLowerCase()
      };
    }
  });

  return fields;
}

function getDetails(rows, options) {
  const details = [];

  rows.forEach((row) => {
    const document = [];
    detailsMap.forEach((field) => {
      const fieldValue = row[field.column];
      if (typeof fieldValue !== undefined) {
        document.push({
          label: field.label,
          value: fieldValue === null ? 'null' : fieldValue,
          type: fieldValue === null ? 'null' : field.type
        });
      }
    });
    if (document.length > 0) {
      details.push(document);
    }
  });

  return details;
}

function getSummaryTags(results, options) {
  const tags = [];

  for (let i = 0; i < options.maxSummaryRows && i < results.length; i++) {
    summaryMap.forEach((field, index) => {
      let result = results[i];
      if (typeof result[field.column] !== undefined) {
        if (field.label) {
          tags.push(`${field.label}: ${result[field.column]}`);
        } else {
          // Capture null values as the string "null" otherwise they are treated as falsey
          // in the template and not displayed.
          tags.push(result[field.column] === null ? 'null' : result[field.column]);
        }
      }
    });
  }

  if (tags.length === 0) {
    tags.push(`${results.length} ${results.length === 1 ? 'result' : 'results'}`);
  } else if (options.maxSummaryRows < results.length) {
    tags.push(`+${results.length - options.maxSummaryRows} results`);
  }

  return tags;
}

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
function doLookup(entities, options, cb) {
  let lookupResults = [];
  let pool = getPool(options);

  Logger.trace({ entities: entities }, 'doLookup');

  summaryMap = processAttributeOption(options.summaryAttributes);
  detailsMap = processAttributeOption(options.detailAttributes);

  Logger.info({ summaryMap, detailsMap }, 'Maps');

  async.each(
    entities,
    (entityObj, done) => {
      let query = {
        text: options.query,
        values: [entityObj.value]
      };

      Logger.debug({ query: query }, 'Query');

      pool.query(query, function (error, results) {
        if (error) {
          return done(error);
        }

        Logger.debug({ results: results }, 'SQL Results');

        if (results.rows.length === 0) {
          lookupResults.push({
            entity: entityObj,
            data: null
          });
        } else {
          lookupResults.push({
            entity: entityObj,
            data: {
              summary: getSummaryTags(results.rows, options),
              details: {
                formatted: detailsMap.length > 0 ? getDetails(results.rows) : null,
                raw: results.rows
              }
            }
          });
        }

        done(null);
      });
    },
    (err) => {
      if (err) {
        Logger.error({ err: err, stack: err.stack }, 'Error Running Query');
        err = {
          detail: 'Error Running Query',
          debug: {
            stack: err.stack,
            err: err
          }
        };
      } else {
        Logger.debug({ lookupResults: lookupResults }, 'Lookup Results');
      }
      cb(err, lookupResults);
    }
  );
}

function validateStringOption(errors, options, optionName, errMessage) {
  if (
    typeof options[optionName].value !== 'string' ||
    (typeof options[optionName].value === 'string' && options[optionName].value.length === 0)
  ) {
    errors.push({
      key: optionName,
      message: errMessage
    });
  }
}

function validateNumberOption(errors, options, optionName, errMessage) {
  if (
    typeof options[optionName].value === 'undefined' ||
    options[optionName] === null ||
    options[optionName].value < 0
  ) {
    errors.push({
      key: optionName,
      message: errMessage
    });
  }
}

function validateOptions(options, cb) {
  let errors = [];

  Logger.trace({ options }, 'Validate Options');

  validateStringOption(errors, options, 'host', '*required');
  validateNumberOption(errors, options, 'port', 'Port must be greater than or equal to 0');
  validateStringOption(errors, options, 'database', '*required');
  validateStringOption(errors, options, 'user', '*required');
  validateStringOption(errors, options, 'password', '*required');
  validateStringOption(errors, options, 'query', '*required');

  if (options.maxSummaryRows.value < 0) {
    errors.push({
      key: 'maxSummaryRows',
      message: 'Max Summary Rows must be greater than or equal to 0'
    });
  }

  cb(null, errors);
}

function startup(logger) {
  Logger = logger;
}

module.exports = {
  doLookup,
  startup,
  validateOptions
};
