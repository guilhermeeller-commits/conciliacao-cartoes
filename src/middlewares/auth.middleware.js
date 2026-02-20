// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }

    // Check if the request is an API request
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Não autorizado. Faça o login.' });
    }

    // Redirect to login page for regular browser requests
    res.redirect('/login.html');
}

// Middleware to skip auth for public assets
function allowPublicAssets(req, res, next) {
    const publicPaths = [
        '/login.html',
        '/css/login.css',
        '/js/login.js',
        '/auth/google',
        '/auth/google/callback',
        '/health' // Keep health check public for load balancers
    ];

    // Se a rota for estritamente igual a um dos caminhos públicos, permite
    if (publicPaths.includes(req.path)) {
        return next();
    }

    // Se for um arquivo genérico de imagens, fontes que possam ser usados no login, liberar também (opcional)
    if (req.path.startsWith('/img/') || req.path.startsWith('/fonts/')) {
        return next();
    }

    // Caso contrário, verificar autenticação
    return ensureAuthenticated(req, res, next);
}

module.exports = {
    ensureAuthenticated,
    allowPublicAssets
};
