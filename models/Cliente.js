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
        trim: true
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
        trim: true,
        unique: true,
        sparse: true  // permite que el campo sea opcional pero único cuando existe
    },
    estado: {
        type: String,
        enum: ['activo', 'inactivo', 'cerrado', 'pendiente', 'en_transito', 'activo_adm', 'activo_jud']
    },
    notas: {
        type: String,
        trim: true
    },
    archivos: {
        type: [String],
        default: []
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
