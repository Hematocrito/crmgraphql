const { ApolloServer, gql } = require('apollo-server');
const typeDefs = require('./db/schema');
const resolvers = require('./db/resolvers');
require('dotenv').config();
const conectarDB = require('./config/db');
const jwt = require('jsonwebtoken');

//Conectar a la base de datos
conectarDB();

//Servidor
const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({req}) => {
        //console.log(req.headers['authorization']);

        //console.log(req.headers);
        const token = req.headers['authorization'] || '';
        const ip = req.headers['x-forwarded-for']
            ? req.headers['x-forwarded-for'].split(',')[0].trim()
            : req.socket && req.socket.remoteAddress
                ? req.socket.remoteAddress
                : null;
        const userAgent = req.headers['user-agent'] || null;

        if(token){
            try {
                const usuario = jwt.verify(token.replace('Bearer ', ''), process.env.SECRETA);
                console.log('Usuario autenticado', usuario);
                return {
                    usuario,
                    ip,
                    userAgent
                }
            } catch (error) {
                console.log('Hubo un error');
                console.log(error);
            }
        }

        return {
            ip,
            userAgent
        };
    }
});

//Arrancar el servidor
server.listen({port: process.env.PORT || 4000}).then( ({url}) => {
    console.log(`servidor listo en la URL ${url}`);
} )

/*
server.listen().then( ({url}) => {
    console.log(`servidor listo en la URL ${url}`);
} ) */
