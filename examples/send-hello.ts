/**
 * Example: Send a hello world email using sendEmailTool
 *
 * Run with: bun run examples/send-hello.ts
 */

import { sendEmailTool } from '../src/index.js';

const body = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello World</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
        }
        h1 {
            color: #333;
            text-align: center;
        }
        ol {
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <h1>Hello World</h1>
    
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
    
    <h2>Favorite Fruits</h2>
    <ol>
        <li>Apple</li>
        <li>Banana</li>
        <li>Orange</li>
        <li>Mango</li>
        <li>Strawberry</li>
        <li>Grapes</li>
    </ol>
</body>
</html>
`
const result = await sendEmailTool({
  to: 'ugmurthy@gmail.com',
  subject: 'Hello world',
  body,
  html: true,
});

if (result.success) {
  console.log(`Email sent! Message ID: ${result.messageId}`);
} else {
  console.error(`Failed: ${result.error}`);
}
