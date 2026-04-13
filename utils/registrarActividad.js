const Actividad = require('../models/Actividad');
const Usuario = require('../models/Usuario');

const registrarActividad = async ({
    ctx,
    accion,
    entidad,
    entidadId = null,
    detalle = {},
    exito = true
}) => {
    try {
        let usuarioId = ctx && ctx.usuario && ctx.usuario.id ? ctx.usuario.id : null;
        let email = ctx && ctx.usuario && ctx.usuario.email ? ctx.usuario.email : null;
        let nombre = ctx && ctx.usuario && ctx.usuario.nombre ? ctx.usuario.nombre : null;
        let apellido = ctx && ctx.usuario && ctx.usuario.apellido ? ctx.usuario.apellido : null;
        let rol = ctx && ctx.usuario && ctx.usuario.rol ? ctx.usuario.rol : null;

        if (usuarioId && (!nombre || !apellido)) {
            const usuario = await Usuario.findById(usuarioId).select('nombre apellido email rol');
            if (usuario) {
                email = email || usuario.email || null;
                nombre = nombre || usuario.nombre || null;
                apellido = apellido || usuario.apellido || null;
                rol = rol || usuario.rol || null;
            }
        }

        await Actividad.create({
            usuario: usuarioId,
            email,
            nombre,
            apellido,
            rol,
            accion,
            entidad,
            entidadId,
            detalle,
            ip: ctx && ctx.ip ? ctx.ip : null,
            userAgent: ctx && ctx.userAgent ? ctx.userAgent : null,
            exito
        });
    } catch (error) {
        console.error('Error registrando actividad:', error.message);
    }
};

module.exports = registrarActividad;
