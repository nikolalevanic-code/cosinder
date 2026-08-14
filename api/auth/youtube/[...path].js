const { handleApiRequest } = require('../../../lib/handler');

module.exports = async (req, res) => {
    const handled = await handleApiRequest(req, res);
    if (handled) return;
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
};
