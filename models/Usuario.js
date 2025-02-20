const mongoose = require('mongoose');

const UsuarioSchema = mongoose.Schema({
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
    email: {
        type: String,
        required: true,
        trim: true,
        unique: true
    }, 
    password: {
        type: String,
        required: true,
        trim: true
    },
    rol: {
        type: String,
        default: 'ABOGADO',
        enum: ['ABOGADO', 'ADMIN']
    },
    creado: {
        type: Date,
        default: Date.now()
    }

});

module.exports = mongoose.model('Usuario', UsuarioSchema);