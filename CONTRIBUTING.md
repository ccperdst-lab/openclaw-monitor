# Contributing to OpenClaw Monitor 3D

Thank you for interest in contributing!

## How to Contribute

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-featura`
3. Make your changes
4. Push your branch and open a PRr

## Development

### Setup
```bash
npm install
node server.js
### Build
```bash
npx esbund monitor-app.js --bundle --format=esm --outfile=public/bundle.js
### Run
```bash
npm start
## Code Structure

- `server.js` - Backend server
- `public/monitor-app.js` - Frontend 3D-app
- `public/index.html` - HTML entry
## Area of Contribution
- Physics system improvements
- Minion model improvements
- New features (chat, notifications, map)
- Bug fixes
## License
MIT License