const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

// Allowed domain
const ALLOWED_DOMAIN = 'calisul.com.br';

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
            // Restringe a tela de login do Google ao domínio corporativo (proteção dupla)
            hd: process.env.GOOGLE_ALLOWED_DOMAIN || 'calisul.com.br',
        },
        function (accessToken, refreshToken, profile, cb) {
            // Check if user's email domain is allowed
            const emails = profile.emails || [];
            const isAllowed = emails.some(
                (emailObj) => emailObj.value.endsWith(`@${ALLOWED_DOMAIN}`) && emailObj.verified
            );

            if (isAllowed) {
                // Return just the minimal user information needed
                const user = {
                    id: profile.id,
                    displayName: profile.displayName,
                    email: emails[0].value,
                    photo: profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null
                };
                return cb(null, user);
            } else {
                return cb(null, false, { message: 'Acesso negado. Utilize um e-mail corporativo @calisul.com.br.' });
            }
        }
    )
);

passport.serializeUser(function (user, done) {
    done(null, user);
});

passport.deserializeUser(function (user, done) {
    done(null, user);
});

module.exports = passport;
