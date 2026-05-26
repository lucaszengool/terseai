/**
 * benchmark/tool-optimization.js
 * Benchmark tool schema compression using sample tool definitions.
 */

import { fileURLToPath } from 'url';
import { optimizeTools } from '../src/tools/optimizer.js';
import { countTokens } from '../src/core/tokenizer.js';

// Realistic sample tools representative of production agent setups
const SAMPLE_TOOLS = [
  {
    name: 'search_files',
    description: 'This tool allows you to search through files in the repository or filesystem. Use this when you need to find files that match certain patterns or contain specific content. It supports glob patterns and regular expressions for flexible searching.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The search pattern to use. This can be a glob pattern like "*.ts" or a regular expression. The pattern will be matched against file paths and optionally file contents.',
        },
        directory: {
          type: 'string',
          description: 'The directory path where you want to start the search. If not specified, the search will start from the current working directory.',
        },
        include_content: {
          type: 'boolean',
          description: 'A boolean flag that indicates whether you want to search within the content of files in addition to just matching file names. Setting this to true will be slower but more thorough.',
        },
        max_results: {
          type: 'integer',
          description: 'The maximum number of results you want to return. This is useful to limit the output when you expect many matches. Defaults to 50 if not specified.',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'read_file',
    description: 'This tool enables you to read the contents of a file at a specified path. It returns the file contents as a string. You should use this tool when you need to examine the content of a specific file, understand its structure, or extract information from it.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The absolute or relative path to the file that you want to read. The path must point to an existing file on the filesystem.',
        },
        encoding: {
          type: 'string',
          description: 'The character encoding to use when reading the file. This parameter is optional and defaults to UTF-8 if not specified. Common values include utf-8, ascii, and base64.',
        },
        start_line: {
          type: 'integer',
          description: 'The line number where you want to start reading from. This is useful when you only want to read a portion of a large file. Line numbers start at 1.',
        },
        end_line: {
          type: 'integer',
          description: 'The line number where you want to stop reading. Used in conjunction with start_line to read a specific range of lines from the file.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'This tool provides the ability to write content to a file at a specified path. It can create new files or overwrite existing ones. Use this tool when you need to save data, create new files, or update existing file contents as part of your task.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path where you want to write the file. This can be an absolute path or a path relative to the current working directory. If parent directories do not exist, they will be created automatically.',
        },
        content: {
          type: 'string',
          description: 'The content that you want to write to the file. This should be a string containing the complete content you want the file to have after writing.',
        },
        append: {
          type: 'boolean',
          description: 'An optional boolean flag that controls whether the content should be appended to the existing file content rather than overwriting it. If set to true, the new content will be added at the end of the existing file.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'execute_command',
    description: 'This tool allows you to execute shell commands on the system. It runs the specified command in a subprocess and returns the standard output and standard error. Use this when you need to run scripts, compile code, install packages, or perform any operation that requires command-line access.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command that you want to execute. This should be a valid shell command that can be run in the current environment.',
        },
        working_directory: {
          type: 'string',
          description: 'An optional path specifying the working directory in which the command should be executed. If not provided, the command will run in the current working directory.',
        },
        timeout: {
          type: 'integer',
          description: 'An optional timeout value in seconds. If the command takes longer than this duration to complete, it will be automatically terminated. Defaults to 30 seconds if not specified.',
        },
        environment: {
          type: 'object',
          description: 'An optional object containing additional environment variables that should be set when executing the command. These will be merged with the current environment variables.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'make_http_request',
    description: 'This tool provides the capability to make HTTP requests to external APIs or web services. It supports all standard HTTP methods including GET, POST, PUT, DELETE, and PATCH. Use this when you need to interact with REST APIs, fetch data from web services, or send data to external endpoints.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The complete URL of the endpoint you want to make a request to. This should include the protocol (http:// or https://), hostname, and any path components.',
        },
        method: {
          type: 'string',
          description: 'The HTTP method to use for the request. Must be one of the following values: GET, POST, PUT, DELETE, PATCH, HEAD, or OPTIONS.',
        },
        headers: {
          type: 'object',
          description: 'An optional object containing HTTP headers to include with the request. This is useful for setting authentication tokens, content type, or other custom headers required by the API.',
        },
        body: {
          type: 'string',
          description: 'The request body to send with the request. This is typically used with POST, PUT, and PATCH requests. The body should be a string, and you should set the appropriate Content-Type header.',
        },
        timeout: {
          type: 'integer',
          description: 'An optional timeout in milliseconds after which the request will be cancelled if no response has been received. Defaults to 30000 milliseconds if not specified.',
        },
      },
      required: ['url', 'method'],
    },
  },
  {
    name: 'query_database',
    description: 'This tool enables you to execute SQL queries against the configured database. It supports both read queries (SELECT) and write queries (INSERT, UPDATE, DELETE). Use this when you need to retrieve, modify, or delete data from the application database.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The SQL query string that you want to execute against the database. Make sure the query is properly formatted and uses parameterized queries to prevent SQL injection.',
        },
        parameters: {
          type: 'array',
          description: 'An optional array of parameter values to use with parameterized queries. These values will be safely substituted into the query in place of placeholders.',
          items: { type: 'string' },
        },
        database: {
          type: 'string',
          description: 'An optional name specifying which database connection to use. If not provided, the default database connection will be used.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_email',
    description: 'This tool provides functionality to send email messages through the configured email service provider. It supports sending to multiple recipients, adding CC and BCC recipients, and attaching files. Use this when you need to notify users, send reports, or communicate via email.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'array',
          description: 'An array containing the email addresses of the primary recipients who should receive the email message.',
          items: { type: 'string' },
        },
        subject: {
          type: 'string',
          description: 'The subject line of the email message. This should be a brief but descriptive summary of the email content.',
        },
        body: {
          type: 'string',
          description: 'The main content of the email message. This can be either plain text or HTML depending on the content_type parameter.',
        },
        cc: {
          type: 'array',
          description: 'An optional array of email addresses to include as CC (carbon copy) recipients. These recipients will receive a copy of the email.',
          items: { type: 'string' },
        },
        attachments: {
          type: 'array',
          description: 'An optional array of file paths pointing to files that should be attached to the email message.',
          items: { type: 'string' },
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'get_user_info',
    description: 'This tool retrieves information about a specific user from the user management system. It returns the user profile data including personal information, account settings, and permissions. Use this when you need to look up details about a particular user account.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'The unique identifier of the user whose information you want to retrieve. This should be the user ID as stored in the database.',
        },
        include_permissions: {
          type: 'boolean',
          description: 'An optional boolean flag that controls whether to include the user permissions and roles in the response. Setting this to true will return additional permission data.',
        },
        include_activity: {
          type: 'boolean',
          description: 'An optional boolean flag that indicates whether to include recent account activity and login history in the response.',
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'create_ticket',
    description: 'This tool allows you to create a new support ticket or issue in the project management system. It creates the ticket with the specified details and returns the newly created ticket ID. Use this when you need to track bugs, feature requests, or any work items that need to be managed.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title or summary of the ticket. This should be a concise but descriptive headline that clearly communicates the nature of the issue or request.',
        },
        description: {
          type: 'string',
          description: 'A detailed description of the ticket providing all relevant context, steps to reproduce (for bugs), or requirements (for features). The more detail provided here, the easier it will be to resolve the ticket.',
        },
        priority: {
          type: 'string',
          description: 'The priority level of the ticket. Must be one of the following values: critical, high, medium, or low. This determines how urgently the ticket needs to be addressed.',
        },
        assignee: {
          type: 'string',
          description: 'An optional user ID or username of the person who should be assigned to work on this ticket. If not specified, the ticket will remain unassigned.',
        },
        labels: {
          type: 'array',
          description: 'An optional array of label strings to apply to the ticket for categorization and filtering purposes.',
          items: { type: 'string' },
        },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'generate_report',
    description: 'This tool generates various types of reports by aggregating data from multiple sources and formatting it in the requested output format. It can create executive summaries, detailed analytics reports, and custom data exports. Use this when you need to compile information into a structured report format for analysis or presentation.',
    input_schema: {
      type: 'object',
      properties: {
        report_type: {
          type: 'string',
          description: 'The type of report you want to generate. Available options include: summary, detailed, analytics, export, and custom. Each type determines the structure and content of the generated report.',
        },
        date_range: {
          type: 'object',
          description: 'An optional object specifying the date range for the data to include in the report. Should contain start_date and end_date fields in ISO 8601 format.',
        },
        format: {
          type: 'string',
          description: 'The output format for the generated report. Supported formats include: pdf, csv, json, html, and markdown. Defaults to json if not specified.',
        },
        filters: {
          type: 'object',
          description: 'An optional object containing filter criteria to apply when generating the report. This allows you to narrow down the data included based on specific conditions.',
        },
      },
      required: ['report_type'],
    },
  },
];

export function runToolOptimization() {
  const originalTokens = countTokens(JSON.stringify(SAMPLE_TOOLS, null, 2));

  // Standard optimization
  const { tools: optimized, stats } = optimizeTools(SAMPLE_TOOLS);
  const compressedTokens = countTokens(JSON.stringify(optimized, null, 2));

  // Aggressive optimization (remove optional params)
  const { tools: aggressive, stats: aggressiveStats } = optimizeTools(SAMPLE_TOOLS, { aggressiveMode: true });
  const aggressiveTokens = countTokens(JSON.stringify(aggressive, null, 2));

  return {
    toolCount: SAMPLE_TOOLS.length,
    original: {
      tokens: originalTokens,
    },
    standard: {
      tokens: compressedTokens,
      saved: originalTokens - compressedTokens,
      reduction: ((originalTokens - compressedTokens) / originalTokens * 100).toFixed(1),
    },
    aggressive: {
      tokens: aggressiveTokens,
      saved: originalTokens - aggressiveTokens,
      reduction: ((originalTokens - aggressiveTokens) / originalTokens * 100).toFixed(1),
    },
    stats,
  };
}

// Allow running standalone
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = runToolOptimization();
  console.log(`\nTool Optimization (${r.toolCount} tools, ${r.original.tokens} tokens)`);
  console.log(`  Standard:    ${r.original.tokens} → ${r.standard.tokens} tokens  (${r.standard.reduction}% reduction)`);
  console.log(`  Aggressive:  ${r.original.tokens} → ${r.aggressive.tokens} tokens  (${r.aggressive.reduction}% reduction)`);
}
