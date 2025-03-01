const { gql } = require('apollo-server');


//Schema
const typeDefs = gql`
    type Usuario {
        id: ID
        nombre: String
        apellido: String
        email: String
        creado: String
        rol: String
    }

    type Cliente {
        id: ID
        nombre: String
        apellido: String
        empresa: String
        email: String
        telefono: String
        avatar: String
        dni: String
        estado: String
        notas: String
        vendedor: ID
    }

    type TopCliente{
        total: Float
        cliente: [Cliente]
    }
    
    type TopVendedor{
        total: Float
        vendedor: [Usuario]
    }
        
    type Token {
        token: String
    } 

    input UsuarioInput{
        nombre: String!
        apellido: String!
        email: String!
        password: String!
        rol: Rol!
    }

    input ClienteInput{
        nombre: String!
        apellido: String!
        empresa: String
        email: String
        telefono: String
        avatar: String
        dni: String
        estado: String!
        notas: String
    }

    input AutenticarInput {
        email: String!
        password: String!
    }

    input EmailInput {
        email: String!
    }

    type ClientesxUsuario {
        id: ID
        nombre: String
        apellido: String
        email: String
        rol: String
        clientes: [Cliente]
    }

    enum Rol {
        usuario
        admin
    }

    type Query {
        # Usuarios
        obtenerUsuario: Usuario

        # Administrador
        obtenerClientesxUsuario: [ClientesxUsuario]

        # Clientes
        obtenerClientes: [Cliente]
        obtenerClientesVendedor: [Cliente]
        obtenerCliente(id: ID!): Cliente

        # Búsquedas avanzadas
        mejoresClientes: [TopCliente]
        mejoresVendedores: [TopVendedor]
    }

    type Mutation {
        # Usuarios
        nuevoUsuario(input: UsuarioInput): Usuario
        autenticarUsuario(input: AutenticarInput): Token
        resetPassword(input: EmailInput): String

        # Clientes
        nuevoCliente(input: ClienteInput): Cliente
        actualizarCliente(id: ID!, input: ClienteInput): Cliente
        eliminarCliente(id: ID!): String
    }
`;

module.exports = typeDefs;