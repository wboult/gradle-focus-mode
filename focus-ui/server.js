const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { createServer } = require('http');
const { Server } = require('socket.io');
const app = express();
const server = createServer(app);
const io = new Server(server);
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static('client/dist'));

// Helper to read config
function readConfig() {
    const configPath = path.join(__dirname, '..', 'focus-config.gradle');
    if (!fs.existsSync(configPath)) return { focusedProjects: [], downstreamHops: 1 };
    const content = fs.readFileSync(configPath, 'utf8');
    const focusedMatch = content.match(/ext\.focusedProjects\s*=\s*\[([^\]]*)\]/);
    const hopsMatch = content.match(/ext\.downstreamHops\s*=\s*(\d+)/);
    let focusedProjects = [];
    if (focusedMatch) {
        // Handle both single and double quotes
        const listStr = focusedMatch[1];
        focusedProjects = listStr.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(s => s);
    }
    const downstreamHops = hopsMatch ? parseInt(hopsMatch[1]) : 1;
    return { focusedProjects, downstreamHops };
}

// Helper to write config
function writeConfig(focusedProjects, downstreamHops) {
    const focusedStr = focusedProjects.map(p => `'${p}'`).join(', ');
    const config = `ext.focusedProjects = [${focusedStr}]\next.downstreamHops = ${downstreamHops}`;
    const configPath = path.join(__dirname, '..', 'focus-config.gradle');
    fs.writeFileSync(configPath, config);
}

// Global dep maps
let depMap = {};
let reverseDepMap = {};
let lastKnownChanges = new Set();

// Helper to build graph
function buildGraph() {
    const projects = [];
    for (let i = 1; i <= 100; i++) {
        const proj = `project-${String(i).padStart(3, '0')}`;
        projects.push(proj);
    }

    depMap = {};
    reverseDepMap = {};
    projects.forEach(proj => {
        const filePath = path.join(__dirname, '..', proj, 'build.gradle');
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const matches = [...content.matchAll(/focusedDep\(':project-(\d+)'/g)];
            depMap[proj] = matches.map(match => `project-${String(match[1]).padStart(3, '0')}`);
            depMap[proj].forEach(dep => {
                if (!reverseDepMap[dep]) reverseDepMap[dep] = [];
                reverseDepMap[dep].push(proj);
            });
            if (matches.length > 0) console.log(`Deps for ${proj}:`, depMap[proj]);
        } else {
            depMap[proj] = [];
        }
    });

    console.log('DepMap sample:', Object.entries(depMap).slice(0, 5));

    const nodes = projects.map(proj => {
        return {
            id: proj,
            label: proj
        };
    });

    const edges = [];
    Object.entries(depMap).forEach(([from, deps]) => {
        deps.forEach(to => {
            edges.push({ from, to });
        });
    });

    console.log('Nodes:', nodes.length, 'Edges:', edges.length);

    return { nodes, edges };
}

// Helper to compute included
function computeIncluded(focusedProjects, downstreamHops) {
    const included = new Set();

    if (focusedProjects.length === 0) {
        // When no projects are focused, include all projects
        for (let i = 1; i <= 100; i++) {
            included.add(`project-${String(i).padStart(3, '0')}`);
        }
    } else {
        focusedProjects.forEach(proj => {
            included.add(proj);
            // Add dependents up to hops
            addDependents(proj, downstreamHops, included, new Set());
        });
    }

    return included;
}

function addDependents(proj, hops, included, visited) {
    if (hops < 0 || visited.has(proj)) return;
    visited.add(proj);
    // Find dependents (projects that depend on proj)
    const dependents = reverseDepMap[proj] || [];
    if (hops > 0) {
        dependents.forEach(dep => {
            if (!included.has(dep)) {
                included.add(dep);
                addDependents(dep, hops - 1, included, visited);
            }
        });
    }
}

// Helper to check git status and notify of changes in non-focused projects
function checkGitChanges() {
    exec('git status --porcelain', { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
        if (error) {
            console.error('Error checking git status:', error);
            return;
        }

        const lines = stdout.trim().split('\n').filter(line => line.trim());
        const currentChanges = new Set();

        // Parse git status output
        lines.forEach(line => {
            const status = line.substring(0, 2);
            const filePath = line.substring(3);
            if (status.trim()) { // Only track modified/added/deleted files
                currentChanges.add(filePath);
            }
        });

        // Find new changes
        const newChanges = [...currentChanges].filter(change => !lastKnownChanges.has(change));

        if (newChanges.length > 0) {
            // Map changes to projects
            const config = readConfig();
            const included = computeIncluded(config.focusedProjects, config.downstreamHops);
            const allProjects = [];
            for (let i = 1; i <= 100; i++) {
                allProjects.push(`project-${String(i).padStart(3, '0')}`);
            }
            const excluded = allProjects.filter(p => !included.has(p));

            const changedProjects = new Set();
            newChanges.forEach(change => {
                // Extract project from path (e.g., project-005/src/main/java/... -> project-005)
                const match = change.match(/^project-\d+/);
                if (match) {
                    changedProjects.add(match[0]);
                }
            });

            // Find non-focused projects with changes
            const nonFocusedChanged = [...changedProjects].filter(proj =>
                !config.focusedProjects.includes(proj)
            );

            if (nonFocusedChanged.length > 0) {
                console.log('Detected changes in non-focused projects:', nonFocusedChanged);
                io.emit('file-changes', {
                    changedProjects: nonFocusedChanged,
                    included: [...included],
                    excluded: excluded
                });
            }
        }

        lastKnownChanges = currentChanges;
    });
}

// API endpoints
app.get('/api/config', (req, res) => {
    const config = readConfig();
    console.log('Sending config:', config);
    res.json(config);
});

app.post('/api/config', (req, res) => {
    const { focusedProjects, downstreamHops } = req.body;
    writeConfig(focusedProjects, downstreamHops);
    res.json({ success: true });
});

app.get('/api/graph', (req, res) => {
    const graph = buildGraph();
    console.log('Sending graph:', graph.nodes.length, 'nodes,', graph.edges.length, 'edges');
    res.json(graph);
});

app.post('/api/applyIdea', (req, res) => {
    try {
        const config = readConfig();
        const included = computeIncluded(config.focusedProjects, config.downstreamHops);
        const allProjects = [];
        for (let i = 1; i <= 100; i++) {
            allProjects.push(`project-${String(i).padStart(3, '0')}`);
        }
        const excluded = allProjects.filter(p => !included.has(p));

        // Write .iml
        const imlPath = path.join(__dirname, '..', '.idea', 'modules', 'focus-mode.iml');
        const imlDir = path.dirname(imlPath);
        if (!fs.existsSync(imlDir)) {
            fs.mkdirSync(imlDir, { recursive: true });
        }
        const excludeXml = excluded.map(p => `<excludeFolder url="file://$MODULE_DIR$/../../${p}" />`).join('\n');
        const imlContent = `<?xml version="1.0" encoding="UTF-8"?>
<module type="JAVA_MODULE" version="4">
  <component name="AdditionalModuleElements">
    <content url="file://$MODULE_DIR$/../.." dumb="true">
${excludeXml}
    </content>
  </component>
</module>`;
        fs.writeFileSync(imlPath, imlContent);
        console.log('IDEA exclusions applied successfully');
        res.json({ success: true });
    } catch (error) {
        console.error('Error applying IDEA exclusions:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve React app for any unmatched routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

// Build graph on startup
buildGraph();

// Start periodic git checking
setInterval(checkGitChanges, 5000); // Check every 5 seconds

server.listen(port, () => {
    console.log(`Focus UI server running at http://localhost:${port}`);
});
