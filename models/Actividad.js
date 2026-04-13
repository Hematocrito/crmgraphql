const mongoose = require('mongoose');

const ActividadSchema = mongoose.Schema({
    usuario: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        default: null
    },
    email: {
        type: String,
        trim: true
    },
    nombre: {
        type: String,
        trim: true
    },
    apellido: {
        type: String,
        trim: true
    },
    rol: {
        type: String,
        trim: true
    },
    accion: {
        type: String,
        required: true,
        trim: true
    },
    entidad: {
        type: String,
        required: true,
        trim: true
    },
    entidadId: {
        type: String,
        default: null,
        trim: true
    },
    detalle: {
        type: Object,
        default: {}
    },
    ip: {
        type: String,
        default: null,
        trim: true
    },
    userAgent: {
        type: String,
        default: null,
        trim: true
    },
    exito: {
        type: Boolean,
        default: true
    },
    creado: {
        type: Date,
        default: Date.now
    }
});

ActividadSchema.index({ creado: -1 });
ActividadSchema.index({ usuario: 1, creado: -1 });
ActividadSchema.index({ entidad: 1, accion: 1, creado: -1 });

module.exports = mongoose.model('Actividad', ActividadSchema);
