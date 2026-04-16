const { execSync } = require('child_process');

module.exports = async (req, res) => {
    const token = req.query.token || req.headers['x-auth-token'];
    if (token !== process.env.UPDATE_SECRET) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        execSync('node update.js', { stdio: 'inherit' });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
