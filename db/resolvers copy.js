const Usuario = require('../models/Usuario');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Cliente = require('../models/Cliente');
require('dotenv').config();

const crearToken = (usuario, secreta, expiresIn) => {
    const { id, email, nombre, apellido, rol } = usuario;
    return jwt.sign({ id, email, rol }, secreta, { expiresIn });
} 

//Resolvers
const resolvers = {
    Query: {
        obtenerUsuario: async (_, {}, ctx) => {
            const id = ctx.usuario.id;
            const usuario = await Usuario.findById(id);
            return usuario;
        },
        obtenerClientes: async () => {
            try {
                const clientes = await Cliente.find({});
                return clientes;
            } catch (error) {
                console.log(error);
            }
        },
        obtenerClientesVendedor: async (_, {}, ctx) => {
            try {
                // Si es superusuario, retorna todos los clientes
                if (ctx.usuario.rol === 'ADMIN') {
                    const clientes = await Cliente.find({});
                    return clientes;
                }
                // Si no es superusuario, solo retorna sus clientes
                const clientes = await Cliente.find({vendedor: ctx.usuario.id.toString()});
                return clientes;
            } catch (error) {
                console.log(error);
            }
        },
        obtenerCliente: async (_, {id}, ctx) => {
            //Revisar si el cliente existe o no
            const cliente = await Cliente.findById(id);
            if(!cliente){
                throw new Error('Cliente no encontrado');
            }

            //Quien lo creo puede verlo o si es superusuario
            if(cliente.vendedor.toString() !== ctx.usuario.id && ctx.usuario.rol !== 'ADMIN'){
                throw new Error('No tienes las credenciales');
            }
            return cliente;
        },
        obtenerClientesxUsuario: async (_, {}, ctx) => {
            // Verificar si es admin
            if (ctx.usuario.rol !== 'admin') {
                throw new Error('No tienes las credenciales para ver esta información');
            }

            try {
                // Obtener todos los usuarios excepto los admin
                const usuarios = await Usuario.find({ rol: { $ne: 'admin' } });
                
                // Para cada usuario, obtener sus clientes
                const usuariosConClientes = await Promise.all(
                    usuarios.map(async (usuario) => {
                        const clientes = await Cliente.find({ vendedor: usuario.id });
                        return {
                            ...usuario._doc,
                            clientes
                        };
                    })
                );

                return usuariosConClientes;
            } catch (error) {
                console.log(error);
                throw new Error('Error al obtener los usuarios y sus clientes');
            }
        }
    },
    Mutation: {
        nuevoUsuario: async (_, { input }) => {
            const { email, password } = input;
            
            //Revisar si el usuario ya está registrado
            const existeUsuario = await Usuario.findOne({email});
            if(existeUsuario){
                throw new Error('El usuario ya está registrado');
            }

            //Hashear el password
            const salt = await bcryptjs.genSaltSync(10);
            input.password = await bcryptjs.hashSync(password, salt);
            
            try {
                //Guardarlo en la base de datos
                const usuario = new Usuario(input);
                usuario.save();
                return usuario;
                
            } catch (error) {
                console.log(error);
            }
        },
        autenticarUsuario: async (_, { input }) => {
            const { email, password } = input;

            //Si el usuario existe
            const existeUsuario = await Usuario.findOne({email});
            if(!existeUsuario){
                throw new Error('El usuario no existe');
            }

            //Revisar si el password es correcto
            const passwordCorrecto = await bcryptjs.compareSync(password, existeUsuario.password);
            if(!passwordCorrecto){
                throw new Error('El password es incorrecto');
            }

            //Generar el token
            return{
                token: crearToken(existeUsuario, process.env.SECRETA, '24h')
            }
        },
        resetPassword: async (_, {input}) => {
            const {email} = input;
            const usuario = await Usuario.findOne({email});
            if(!usuario){
                throw new Error('El usuario no existe');
            }
        },  
        nuevoCliente: async (_, {input}, ctx) => {
            //Verificar si el cliente ya está registrado
            const {email} = input;
            const cliente = await Cliente.findOne({email});
            if(cliente){
                throw new Error('Ese cliente ya está registrado');
            }
            const nuevoCliente = new Cliente(input);

            //Asignar el vendedor
            nuevoCliente.vendedor = ctx.usuario.id;

            //Guardar en la base de datos
            try {
                const resultado = await nuevoCliente.save();
                return resultado;
            } catch (error) {
                console.log(error);
            }
        },
        actualizarCliente: async (_, {id, input}, ctx) => {
            //Verificar si existe o no
            let cliente = await Cliente.findById(id);
            if(!cliente){
                throw new Error('Ese cliente no existe');
            }

            //Verificar si el vendedor es quien edita o si es superusuario
            if(cliente.vendedor.toString() !== ctx.usuario.id && ctx.usuario.rol !== 'admin'){
                throw new Error('No tienes las credenciales');
            }
            //Guardar el cliente
            cliente = await Cliente.findOneAndUpdate({_id: id}, input, {new: true});
            return cliente;
        },
        eliminarCliente: async (_, {id}, ctx) => {
            //Verificar si existe o no
            let cliente = await Cliente.findById(id);
            if(!cliente){
                throw new Error('Ese cliente no existe');
            }

            //Verificar si el vendedor es quien edita o si es superusuario
            if(cliente.vendedor.toString() !== ctx.usuario.id && ctx.usuario.rol !== 'ADMIN'){
                throw new Error('No tienes las credenciales');
            }

            //Eliminar cliente
            await Cliente.findOneAndDelete({_id: cliente._id});
            return "Cliente eliminado";
        }
    }
}

module.exports = resolvers;
