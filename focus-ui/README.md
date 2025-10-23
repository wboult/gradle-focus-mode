# Focus Mode UI

This is a standalone UI for managing Gradle focus mode.

## Usage

1. Install Node.js (if not already installed).
2. Run `npm install` in this directory.
3. Run `npm start` to start the server.
4. Open `http://localhost:3000` in your web browser.
5. The UI will automatically load the dependency graph and current config.
6. Click on project nodes to toggle focus (red background indicates focused).
7. Adjust downstream hops with the slider to include more dependency levels.
8. Use the search to filter projects by name or ID.
9. Click "Update Focus Config" to save changes directly to `../focus-config.gradle`.
10. Click "Apply IDEA Exclusions" to see the command to run IDEA exclusions.

## Requirements

- Modern web browser with JavaScript enabled.
- Access to local files (works from `file://` protocol).

## Notes

- For reusability, copy this `focus-ui` folder to any Gradle multi-project with similar structure.
- Update the project list in `index.html` if different from project-001 to project-100.
