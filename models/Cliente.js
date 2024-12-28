const mongoose = require('mongoose');

const ClientesSchema = mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        trim: true
    }, 
    apellido: {
        type: String,
        required: true,
        trim: true
    },
    empresa: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        unique: true
    }, 
    telefono: {
        type: String,
        trim: true
    }, 
    avatar: {
        type: String,
        trim: true
    },
    dni: {
        type: String,
        trim: true
    },
    estado: {
        type: String,
        enum: ['activo', 'inactivo', 'cerrado', 'pendiente']
    },
    creado: {
        type: Date,
        default: Date.now()
    },
    vendedor: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Usuario'
    }
});

module.exports = mongoose.model('Cliente', ClientesSchema);