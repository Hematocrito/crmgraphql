const { gql } = require('apollo-server');


//Schema
const typeDefs = gql`
    type Usuario {
        id: ID
        nombre: String
        apellido: String
        email: String
        creado: String
    }

    type Producto {
        id: ID
        nombre: String
        existencia: Int
        precio: Float
        creado: String
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

    type Pedido{
        id: ID
        pedido: [PedidoGrupo]
        total: Float
        cliente: ID
        vendedor: ID
        fecha: String
        estado: EstadoPedido
    }

    type PedidoGrupo{
        id: ID 
        cantidad: Int   
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
    }

    input ProductoInput{
        nombre: String!
        existencia: Int!
        precio: Float!
    }

    input ClienteInput{
        nombre: String!
        apellido: String!
        empresa: String
        email: String!
        telefono: String
        avatar: String
        dni: String
        estado: String
        notas: String
    }

    input PedidoProductoInput{
        id: ID
        cantidad: Int
    }

    input PedidoInput{
        pedido: [PedidoProductoInput]
        total: Float
        cliente: ID
        estado: EstadoPedido
    }

    enum EstadoPedido{
        PENDIENTE
        COMPLETADO
        CANCELADO
    }

    input AutenticarInput {
        email: String!
        password: String!
    }

    type Query {
        # Usuarios
        obtenerUsuario: Usuario

        # Productos
        obtenerProductos: [Producto]
        obtenerProducto(id: ID!) : Producto

        # Clientes
        obtenerClientes: [Cliente]
        obtenerClientesVendedor: [Cliente]
        obtenerCliente(id: ID!): Cliente

        # Pedidos
        obtenerPedidos: [Pedido]
        obtenerPedidosVendedor: [Pedido]
        obtenerPedido(id: ID!): Pedido
        obtenerPedidosEstado(estado: String!): [Pedido]

        # Búsquedas avanzadas
        mejoresClientes: [TopCliente]
        mejoresVendedores: [TopVendedor]
        buscarProducto(texto: String!): [Producto]
    }

    type Mutation {
        # Usuarios
        nuevoUsuario(input: UsuarioInput): Usuario
        autenticarUsuario(input: AutenticarInput): Token

        # Productos
        nuevoProducto(input: ProductoInput): Producto
        actualizarProducto(id: ID!, input: ProductoInput): Producto
        eliminarProducto(id: ID!): String

        # Clientes
        nuevoCliente(input: ClienteInput): Cliente
        actualizarCliente(id: ID!, input: ClienteInput): Cliente
        eliminarCliente(id: ID!): String

        # Pedidos
        nuevoPedido(input: PedidoInput): Pedido
        actualizarPedido(id: ID!, input: PedidoInput): Pedido
        eliminarPedido(id: ID!): String
    }
`;

module.exports = typeDefs;