const { ApolloServer, gql } = require('apollo-server');
const typeDefs = require('./db/schema');
const resolvers = require('./db/resolvers');
require('dotenv').config({ path: 'variables.env' });
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
        if(token){
            try {
                const usuario = jwt.verify(token.replace('Bearer ', ''), process.env.SECRETA);
                console.log('Usuario autenticado', usuario);
                return {
                    usuario
                }
            } catch (error) {
                console.log('Hubo un error');
                console.log(error);
            }
        }
    }
});

//Arrancar el servidor
server.listen().then( ({url}) => {
    console.log(`servidor listo en la URL ${url}`);
} )