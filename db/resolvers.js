const Usuario = require('../models/Usuario');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Cliente = require('../models/Cliente');
const AgendaEvent = require('../models/AgendaEvent');
const Actividad = require('../models/Actividad');
const nodemailer = require('nodemailer');
const registrarActividad = require('../utils/registrarActividad');
require('dotenv').config();
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Configurar el transporter de nodemailer
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER, // tu email
        pass: process.env.EMAIL_PASS  // tu contraseña de aplicación de Gmail
    }
});

const crearToken = (usuario, secreta, expiresIn) => {
    const { id, email, nombre, apellido, rol } = usuario;
    return jwt.sign({ id, email, rol }, secreta, { expiresIn });
} 

const postJson = (url, data) => {
    if (!url) return Promise.resolve({ status: 0, body: '' });
    const parsed = new URL(url);
    const payload = JSON.stringify(data);
    const transport = parsed.protocol === 'https:' ? https : http;
    const options = {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search || ''}`,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    return new Promise((resolve, reject) => {
        const req = transport.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                resolve({ status: res.statusCode || 0, body });
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
};

const normalizeDateInput = (value) => {
    if (!value) return value;
    const raw = String(value).trim();
    // dd/mm/yyyy -> yyyy-mm-dd
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
        const [dd, mm, yyyy] = raw.split('/');
        return `${yyyy}-${mm}-${dd}`;
    }
    // yyyy-mm-dd or yyyy-mm-ddThh:mm:ss
    if (raw.includes('T')) return raw.split('T')[0];
    return raw;
};

const normalizeTimeInput = (value) => {
    if (!value) return value;
    const raw = String(value).trim();
    if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
    return raw;
};

const buildDateRangeFilter = (value) => {
    const normalized = normalizeDateInput(value);
    if (!normalized) return null;

    const start = new Date(`${normalized}T00:00:00.000Z`);
    const end = new Date(`${normalized}T23:59:59.999Z`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    return { $gte: start, $lte: end };
};

// Helpers para subir archivos a Vercel Blob
const mimeFromExt = (ext) => {
    switch ((ext || '').toLowerCase()) {
        case 'pdf': return 'application/pdf';
        case 'doc': return 'application/msword';
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'png': return 'image/png';
        default: return 'application/octet-stream';
    }
};

const extFromMime = (mime) => {
    switch ((mime || '').toLowerCase()) {
        case 'application/pdf': return 'pdf';
        case 'application/msword': return 'doc';
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'docx';
        case 'image/jpeg': return 'jpg';
        case 'image/png': return 'png';
        default: return 'bin';
    }
};

const parseDataUrl = (dataUrl) => {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!match) return null;
    const mime = match[1];
    const base64 = match[2];
    const buffer = Buffer.from(base64, 'base64');
    const ext = extFromMime(mime);
    return { buffer, mime, ext };
};

const agendaWebhookUrl =
    process.env.N8N_WEBHOOK_URL ||
    'https://hemaia.cloud/webhook/2cc079d6-4720-4a37-b7bf-882833478acd';

const agendaWebhookDedupWindowMs = 5000;
const recentAgendaWebhookPayloads = new Map();

const normalizeAgendaWebhookDate = (value) => {
    if (!value) return null;
    const raw = String(value);
    return raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
};

const normalizeAgendaWebhookTime = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
    if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
    return raw;
};

const buildAgendaWebhookDedupKey = (payload) => {
    if (!payload || !payload.action || !payload.eventoId) return null;

    return JSON.stringify({
        action: payload.action,
        eventoId: payload.eventoId,
        titulo: payload.titulo || '',
        descripcion: payload.descripcion || '',
        fecha: payload.fecha || '',
        hora: payload.hora || '',
        ubicacion: payload.ubicacion || '',
        cliente: payload.cliente || '',
        tipo: payload.tipo || '',
        usuarioId: payload.usuarioId || ''
    });
};

const postAgendaWebhook = async (payload) => {
    const now = Date.now();
    const dedupKey = buildAgendaWebhookDedupKey(payload);

    for (const [key, timestamp] of recentAgendaWebhookPayloads.entries()) {
        if (now - timestamp > agendaWebhookDedupWindowMs) {
            recentAgendaWebhookPayloads.delete(key);
        }
    }

    if (dedupKey && recentAgendaWebhookPayloads.has(dedupKey)) {
        console.log('Skipping duplicate agenda webhook payload:', dedupKey);
        return { status: 202, body: 'duplicate_skipped' };
    }

    if (dedupKey) {
        recentAgendaWebhookPayloads.set(dedupKey, now);
    }

    try {
        //console.log('PAYLOAD QUE VA AL WEBHOOK:', payload);
        return await postJson(agendaWebhookUrl, payload);
    } catch (error) {
        if (dedupKey) {
            recentAgendaWebhookPayloads.delete(dedupKey);
        }
        throw error;
    }
};

const generateShortFileHash = () => {
    const value = Math.floor(Math.random() * (36 ** 3));
    return value.toString(36).padStart(3, '0');
};

const sanitizeFilename = (rawName, ext) => {
    const allowed = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
    const segment = (rawName || '')
        .split(/[\\\\/]/)
        .pop()
        .split('?')[0]
        .split('#')[0]
        .trim();

    const fallbackExt = (ext || '').toLowerCase();
    const dotIndex = segment.lastIndexOf('.');
    let basePart = dotIndex > 0 ? segment.slice(0, dotIndex) : segment;
    let extPart = dotIndex > 0 ? segment.slice(dotIndex + 1) : '';

    basePart = basePart
        .replace(/[\\*?:<>"'|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[-.]+/, '')
        .replace(/[-.]+$/, '');

    if (!basePart) basePart = 'archivo';

    let pickedExt = (extPart || fallbackExt || '').toLowerCase();
    if (!allowed.includes(pickedExt) && allowed.includes(fallbackExt)) {
        pickedExt = fallbackExt;
    }
    if (!allowed.includes(pickedExt)) {
        pickedExt = 'bin';
    }

    return `${basePart}.${pickedExt}`;
};

const uploadArchivosAVercelBlob = async (archivos) => {
    if (!Array.isArray(archivos) || archivos.length === 0) return [];
    const { put } = await import('@vercel/blob');
    const permitidos = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
    const preserved = [];
    const urls = [];
    const usedFilenames = new Set();
    const maxArchivos = 3;

    for (const rawItem of archivos.slice(0, maxArchivos)) {
        if (typeof rawItem !== 'string') continue;

        const item = rawItem.trim();
        if (!item) continue;

        let buffer = null;
        let mime = 'application/octet-stream';
        let ext = 'bin';
        let filename = null;

        if (!buffer && item.startsWith('{')) {
            try {
                const parsed = JSON.parse(item);
                if (parsed && parsed.data) {
                    filename = parsed.name || filename;
                    if (typeof parsed.data === 'string' && parsed.data.startsWith('data:')) {
                        const res = parseDataUrl(parsed.data);
                        if (res) { buffer = res.buffer; mime = res.mime; ext = res.ext; }
                    } else if (typeof parsed.data === 'string') {
                        const b64 = parsed.data.includes(',') ? parsed.data.split(',').pop() : parsed.data;
                        buffer = Buffer.from(b64, 'base64');
                        if (!ext && filename && filename.includes('.')) ext = filename.split('.').pop();
                        mime = mimeFromExt(ext);
                    }
                }
            } catch (_) { /* ignore */ }
        }

        if (!buffer && item.startsWith('data:')) {
            const res = parseDataUrl(item);
            if (res) { buffer = res.buffer; mime = res.mime; ext = res.ext; }
        }

        if (!buffer && item.includes('|')) {
            const [name, data] = item.split('|', 2);
            filename = filename || name;
            const b64 = (data || '').includes(',') ? data.split(',').pop() : data;
            if (b64) {
                buffer = Buffer.from(b64, 'base64');
                if (name && name.includes('.')) ext = name.split('.').pop();
                mime = mimeFromExt(ext);
            }
        }

        if (!buffer && (item.startsWith('http://') || item.startsWith('https://'))) {
            preserved.push(item);
            continue;
        }

        if (!buffer) continue;

        if (!permitidos.includes((ext || '').toLowerCase())) {
            const deducedExt = extFromMime(mime);
            if (!permitidos.includes((deducedExt || '').toLowerCase())) {
                continue;
            } else {
                ext = deducedExt;
            }
        }

        const sanitizedName = sanitizeFilename(filename, ext);
        const dotIndex = sanitizedName.lastIndexOf('.');
        const basePart = dotIndex > 0 ? sanitizedName.slice(0, dotIndex) : sanitizedName;
        const normalizedExt = (dotIndex > 0 ? sanitizedName.slice(dotIndex + 1) : (ext || 'bin')).toLowerCase();

        let candidateName = `${basePart}.${normalizedExt}`;
        let candidateKey = candidateName.toLowerCase();
        while (usedFilenames.has(candidateKey)) {
            candidateName = `${basePart}-${generateShortFileHash()}.${normalizedExt}`;
            candidateKey = candidateName.toLowerCase();
        }

        usedFilenames.add(candidateKey);
        filename = candidateName;

        const folderSegment = `${Date.now().toString(36)}-${generateShortFileHash()}`;
        const key = `archivos/${folderSegment}/${filename}`;
        const { url } = await put(key, buffer, {
            access: 'public',
            contentType: mimeFromExt(ext),
            addRandomSuffix: false
        });
        urls.push(url);
    }

    return [...preserved, ...urls];
};

//Resolvers
const resolvers = {
    Query: {
        obtenerUsuario: async (_, {}, ctx) => {
            const id = ctx.usuario.id;
            const usuario = await Usuario.findById(id);
            return usuario;
        },
        obtenerClientes: async (_, {}, ctx) => {
            try {
                const clientes = await Cliente.find({});
                await registrarActividad({
                    ctx,
                    accion: 'listar',
                    entidad: 'cliente',
                    detalle: {
                        total: clientes.length,
                        alcance: 'todos'
                    }
                });
                return clientes;
            } catch (error) {
                console.log(error);
            }
        },
        obtenerClientesVendedor: async (_, {}, ctx) => {
            try {
                // Si es superusuario, retorna todos los clientes
                if (ctx.usuario.rol === 'admin') {
                    const clientes = await Cliente.find({}).sort({ creado: -1 });
                    await registrarActividad({
                        ctx,
                        accion: 'listar',
                        entidad: 'cliente',
                        detalle: {
                            total: clientes.length,
                            alcance: 'todos'
                        }
                    });
                    return clientes;
                }
                // Si no es superusuario, solo retorna sus clientes
                const clientes = await Cliente.find({vendedor: ctx.usuario.id.toString()}).sort({ creado: -1 });
                await registrarActividad({
                    ctx,
                    accion: 'listar',
                    entidad: 'cliente',
                    detalle: {
                        total: clientes.length,
                        alcance: 'vendedor',
                        vendedor: ctx.usuario.id.toString()
                    }
                });
                return clientes;
            } catch (error) {
                console.log(error);
            }
        },
        obtenerCliente: async (_, {id}, ctx) => {
            //Revisar si el cliente existe o no
            const cliente = await Cliente.findById(id);
            if(!cliente){
                await registrarActividad({
                    ctx,
                    accion: 'ver',
                    entidad: 'cliente',
                    entidadId: id,
                    detalle: {
                        motivo: 'cliente_no_encontrado'
                    },
                    exito: false
                });
                throw new Error('Cliente no encontrado');
            }
            
            /* Quien lo creo puede verlo o si es superusuario
            if(cliente.vendedor.toString() !== ctx.usuario.id && ctx.usuario.rol !== 'admin'){
                throw new Error('No tienes las credenciales');
            } */
            await registrarActividad({
                ctx,
                accion: 'ver',
                entidad: 'cliente',
                entidadId: cliente._id.toString(),
                detalle: {
                    nombre: cliente.nombre,
                    apellido: cliente.apellido,
                    dni: cliente.dni,
                    estado: cliente.estado
                }
            });

            return cliente;
        },
        obtenerClientesxUsuario: async (_, {}, ctx) => {
            /* Verificar si es admin
            if (ctx.usuario.rol !== 'admin') {
                throw new Error('No tienes las credenciales para ver esta información');
            } */

            const STATUS_LABELS = {
                activo: 'Activo',
                inactivo: 'Inactivo',
                cerrado: 'Cerrado',
                pendiente: 'Pendiente',
                en_transito: 'En tránsito',
                activo_adm: 'Activo Administrativo',
                activo_jud: 'Activo Judicial'
            };

            try {
                // Obtener todos los usuarios excepto los admin
                const usuarios = await Usuario.find({}).sort({ creado: -1 });
                
                // Para cada usuario, obtener sus clientes
                const usuariosConClientes = await Promise.all(
                    usuarios.map(async (usuario) => {
                        const clientes = await Cliente.find({ vendedor: usuario.id }).sort({ creado: -1 });
                        const clientesConEstadoFormateado = clientes.map((cliente) => {
                            const base =
                                typeof cliente.toObject === 'function'
                                    ? cliente.toObject({ getters: true, virtuals: true })
                                    : cliente._doc
                                    ? { ...cliente._doc }
                                    : { ...cliente };

                            const idFromDoc =
                                cliente.id ||
                                (cliente._id && typeof cliente._id.toString === 'function'
                                    ? cliente._id.toString()
                                    : null);

                            if (idFromDoc) {
                                base.id = idFromDoc;
                            }

                            if (!base._id && cliente._id) {
                                base._id = cliente._id;
                            }

                            if (typeof base.estado === 'string') {
                                const normalized = base.estado.trim().toLowerCase();
                                base.estado = STATUS_LABELS[normalized] || base.estado;
                            }

                            return base;
                        });
                        return {
                            ...usuario._doc,
                            clientes: clientesConEstadoFormateado
                        };
                    })
                );

                await registrarActividad({
                    ctx,
                    accion: 'listar_por_usuario',
                    entidad: 'cliente',
                    detalle: {
                        totalUsuarios: usuariosConClientes.length,
                        totalClientes: usuariosConClientes.reduce((total, usuario) => (
                            total + (Array.isArray(usuario.clientes) ? usuario.clientes.length : 0)
                        ), 0)
                    }
                });

                return usuariosConClientes;
            } catch (error) {
                console.log(error);
                throw new Error('Error al obtener los usuarios y sus clientes');
            }
        },
        obtenerEventosAgenda: async (_, { fecha }, ctx) => {
            const normalizedDate = normalizeDateInput(fecha);
            const filter = { date: normalizedDate };
            try {
                const eventos = await AgendaEvent.find(filter).sort({ time: 1, createdAt: 1 });
                return eventos;
            } catch (error) {
                console.log(error);
                throw new Error('No se pudieron obtener los eventos');
            }
        },
        obtenerActividades: async (_, { fecha, entidad, accion, usuarioId, limit }, ctx) => {
            const filter = {};

            if (fecha) {
                const dateRange = buildDateRangeFilter(fecha);
                if (dateRange) {
                    filter.creado = dateRange;
                }
            }

            if (entidad) {
                filter.entidad = entidad;
            }

            if (accion) {
                filter.accion = accion;
            }

            if (usuarioId) {
                filter.usuario = usuarioId;
            }

            const safeLimit = Number.isInteger(limit) && limit > 0
                ? Math.min(limit, 100)
                : 50;

            try {
                const actividades = await Actividad.find(filter)
                    .sort({ creado: -1 })
                    .limit(safeLimit);

                return actividades.map((actividad) => ({
                    id: actividad._id.toString(),
                    usuario: actividad.usuario ? String(actividad.usuario) : null,
                    email: actividad.email || null,
                    nombre: actividad.nombre || null,
                    apellido: actividad.apellido || null,
                    rol: actividad.rol || null,
                    accion: actividad.accion,
                    entidad: actividad.entidad,
                    entidadId: actividad.entidadId || null,
                    detalle: JSON.stringify(actividad.detalle || {}),
                    ip: actividad.ip || null,
                    userAgent: actividad.userAgent || null,
                    exito: actividad.exito,
                    creado: actividad.creado ? actividad.creado.toISOString() : null
                }));
            } catch (error) {
                console.log(error);
                throw new Error('No se pudieron obtener las actividades');
            }
        }
    },
    Mutation: {
        nuevoUsuario: async (_, { input }, ctx) => {
            const { email, password } = input;
            
            //Revisar si el usuario ya está registrado
            const existeUsuario = await Usuario.findOne({email});
            if(existeUsuario){
                throw new Error('El usuario ya está registrado');
            }

            //Hashear el password
            const salt = await bcryptjs.genSaltSync(10);
            input.password = await bcryptjs.hashSync(password, salt);
            input.autorizado = false;
            
            try {
                //Guardarlo en la base de datos
                const usuario = new Usuario(input);
                await usuario.save();
                await registrarActividad({
                    ctx,
                    accion: 'crear_usuario',
                    entidad: 'usuario',
                    entidadId: usuario._id.toString(),
                    detalle: {
                        email: usuario.email,
                        rol: usuario.rol,
                        autorizado: usuario.autorizado
                    }
                });
                return usuario;
                
            } catch (error) {
                console.log(error);
            }
        },
        autenticarUsuario: async (_, { input }, ctx) => {
            const { email, password } = input;

            //Si el usuario existe
            const existeUsuario = await Usuario.findOne({email});
            if(!existeUsuario){
                await registrarActividad({
                    ctx,
                    accion: 'login',
                    entidad: 'auth',
                    detalle: { email, motivo: 'usuario_no_existe' },
                    exito: false
                });
                throw new Error('El usuario no existe');
            }

            //Revisar si el password es correcto
            const passwordCorrecto = await bcryptjs.compareSync(password, existeUsuario.password);
            if(!passwordCorrecto){
                await registrarActividad({
                    ctx: {
                        ...ctx,
                        usuario: {
                            id: existeUsuario.id,
                            email: existeUsuario.email,
                            rol: existeUsuario.rol
                        }
                    },
                    accion: 'login',
                    entidad: 'auth',
                    entidadId: existeUsuario.id,
                    detalle: { email, motivo: 'password_incorrecto' },
                    exito: false
                });
                throw new Error('El password es incorrecto');
            }

            if(existeUsuario.autorizado === false){
                await registrarActividad({
                    ctx: {
                        ...ctx,
                        usuario: {
                            id: existeUsuario.id,
                            email: existeUsuario.email,
                            rol: existeUsuario.rol
                        }
                    },
                    accion: 'login',
                    entidad: 'auth',
                    entidadId: existeUsuario.id,
                    detalle: { email, motivo: 'usuario_pendiente_autorizacion' },
                    exito: false
                });
                throw new Error('Tu usuario esta pendiente de autorizacion');
            }

            await registrarActividad({
                ctx: {
                    ...ctx,
                    usuario: {
                        id: existeUsuario.id,
                        email: existeUsuario.email,
                        rol: existeUsuario.rol
                    }
                },
                accion: 'login',
                entidad: 'auth',
                entidadId: existeUsuario.id,
                detalle: { email }
            });

            //Generar el token
            return{
                token: crearToken(existeUsuario, process.env.SECRETA, '24h')
            }
        },
        autorizarUsuario: async (_, { id }, ctx) => {
            if (!ctx.usuario || ctx.usuario.rol !== 'admin') {
                throw new Error('No tienes las credenciales');
            }

            const usuario = await Usuario.findById(id);
            if (!usuario) {
                throw new Error('El usuario no existe');
            }

            usuario.autorizado = true;
            await usuario.save();

            await registrarActividad({
                ctx,
                accion: 'autorizar_usuario',
                entidad: 'usuario',
                entidadId: usuario._id.toString(),
                detalle: {
                    email: usuario.email,
                    rol: usuario.rol,
                    autorizado: usuario.autorizado
                }
            });

            return usuario;
        },
        resetPassword: async (_, {input}, ctx) => {
            const {email} = input;
            
            // Verificar si el usuario existe
            const usuario = await Usuario.findOne({email});
            if(!usuario){
                await registrarActividad({
                    ctx,
                    accion: 'solicitar_reset_password',
                    entidad: 'auth',
                    detalle: { email, motivo: 'usuario_no_existe' },
                    exito: false
                });
                throw new Error('El usuario no existe');
            }

            try {
                // Generar token temporal
                const resetToken = jwt.sign(
                    { id: usuario.id, email: usuario.email },
                    process.env.SECRETA,
                    { expiresIn: '1h' }
                );

                // Enviar email
                await transporter.sendMail({
                    from: process.env.EMAIL_FROM,
                    to: email,
                    subject: "Restablecer Contraseña - Estudio Murga",
                    html: `
                        <h1>Restablecer tu contraseña</h1>
                        <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace:</p>
                        <a href="${process.env.FRONTEND_URL}/nuevo-password/${resetToken}">Restablecer Contraseña</a>
                        <p>Si no solicitaste este cambio, puedes ignorar este mensaje.</p>
                        <p>El enlace expirará en 1 hora.</p>
                    `
                });

                await registrarActividad({
                    ctx: {
                        ...ctx,
                        usuario: {
                            id: usuario.id,
                            email: usuario.email,
                            rol: usuario.rol
                        }
                    },
                    accion: 'solicitar_reset_password',
                    entidad: 'auth',
                    entidadId: usuario.id,
                    detalle: { email }
                });

                return "Se ha enviado un email con las instrucciones";
                
            } catch (error) {
                console.log(error);
                throw new Error('Error al enviar el email');
            }
        }, 
        updatePassword: async (_, { input }, ctx) => {
            const { token, newPass } = input;

            try {
                const decoded = jwt.verify(token, process.env.SECRETA);        
                const usuario = await Usuario.findOne({ email: decoded.email });
        
                if (!usuario) {
                    throw new Error('Usuario no encontrado');
                }

                //Hashear el password
                const salt = await bcryptjs.genSaltSync(10);
                usuario.password = await bcryptjs.hashSync(newPass, salt);
                await usuario.save();

                await registrarActividad({
                    ctx: {
                        ...ctx,
                        usuario: {
                            id: usuario.id,
                            email: usuario.email,
                            rol: usuario.rol
                        }
                    },
                    accion: 'actualizar_password',
                    entidad: 'auth',
                    entidadId: usuario.id,
                    detalle: { email: usuario.email }
                });

                return "Contraseña actualizada correctamente";
            } catch (error) {
                throw new Error('Token inválido o expirado');
            }
        },
        nuevoCliente: async (_, {input}, ctx) => {
            //Verificar si el cliente ya está registrado
            const {dni} = input;
            const cliente = await Cliente.findOne({dni});
            if(cliente){
                throw new Error('Ese cliente ya está registrado');
            } 
           
            // Validar y limitar archivos (max 3, formatos PDF/DOC/DOCX/JPG/JPEG/PNG)
            if (input.archivos && Array.isArray(input.archivos)) {
                const permitidos = [
                    '.pdf',
                    '.doc',
                    '.docx',
                    '.jpg',
                    '.jpeg',
                    '.png'
                ];
                const normalizados = input.archivos
                    .filter((a) => typeof a === 'string')
                    .filter((a) => {
                        const trimmed = a.trim();
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (parsed && typeof parsed.name === 'string') {
                                const lowerName = parsed.name.toLowerCase().split('?' )[0];
                                return permitidos.some((ext) => lowerName.endsWith(ext));
                            }
                        } catch (error) {
                            // Ignore non-JSON strings and fallback to suffix check below
                        }
                        const lower = trimmed.toLowerCase().split('?')[0];
                        return permitidos.some((ext) => lower.endsWith(ext));
                    })
                    .slice(0, 3);
                input.archivos = normalizados;
            }

            const nuevoCliente = new Cliente(input);

            //Asignar el vendedor
            nuevoCliente.vendedor = ctx.usuario.id;

            //Guardar en la base de datos
            try {
                const resultado = await nuevoCliente.save();
                await registrarActividad({
                    ctx,
                    accion: 'crear',
                    entidad: 'cliente',
                    entidadId: resultado._id.toString(),
                    detalle: {
                        nombre: resultado.nombre,
                        apellido: resultado.apellido,
                        dni: resultado.dni,
                        estado: resultado.estado
                    }
                });
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

            /* Verificar si el vendedor es quien edita o si es superusuario
            if(cliente.vendedor.toString() !== ctx.usuario.id && ctx.usuario.rol !== 'admin'){
                throw new Error('No tienes las credenciales');
            } */
            console.log('Input:', input);
            // Validar y limitar archivos (max 3, formatos PDF/DOC/DOCX/JPG/JPEG/PNG)
            if (input.archivos && Array.isArray(input.archivos)) {
                const permitidos = [
                    '.pdf',
                    '.doc',
                    '.docx',
                    '.jpg',
                    '.jpeg',
                    '.png'
                ];
                const normalizados = input.archivos
                    .filter((a) => typeof a === 'string')
                    .filter((a) => {
                        const trimmed = a.trim();
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (parsed && typeof parsed.name === 'string') {
                                const lowerName = parsed.name.toLowerCase().split('?' )[0];
                                return permitidos.some((ext) => lowerName.endsWith(ext));
                            }
                        } catch (error) {
                            // Ignore non-JSON strings and fallback to suffix check below
                        }
                        const lower = trimmed.toLowerCase().split('?')[0];
                        return permitidos.some((ext) => lower.endsWith(ext));
                    })
                    .slice(0, 3);
                input.archivos = normalizados;
            }
            
            // Subir archivos a Vercel Blob en carpeta 'archivos' y guardar URLs
            if (input.archivos && Array.isArray(input.archivos) && input.archivos.length > 0) {
                try {
                    const urls = await uploadArchivosAVercelBlob(input.archivos);
                    input.archivos = urls;
                    console.log('Archivos subidos a Vercel Blob:', urls);
                } catch (e) {
                    console.error('Error subiendo archivos a Vercel Blob', e);
                    throw new Error('No se pudieron subir los archivos');
                }
            }

            //Guardar el cliente
            cliente = await Cliente.findOneAndUpdate({_id: id}, input, {new: true});
            await registrarActividad({
                ctx,
                accion: 'editar',
                entidad: 'cliente',
                entidadId: id,
                detalle: {
                    camposEditados: Object.keys(input),
                    nombre: cliente.nombre,
                    apellido: cliente.apellido,
                    dni: cliente.dni,
                    estado: cliente.estado
                }
            });
            return cliente;
        },
        eliminarCliente: async (_, {id}, ctx) => {
            //Verificar si existe o no
            let cliente = await Cliente.findById(id);
            if(!cliente){
                throw new Error('Ese cliente no existe');
            }

            //Verificar si el vendedor es quien edita o si es superusuario
            if(cliente.vendedor.toString() !== ctx.usuario.id && ctx.usuario.rol !== 'admin'){
                throw new Error('No tienes las credenciales');
            }

            //Eliminar cliente
            await Cliente.findOneAndDelete({_id: cliente._id});
            await registrarActividad({
                ctx,
                accion: 'eliminar',
                entidad: 'cliente',
                entidadId: cliente._id.toString(),
                detalle: {
                    nombre: cliente.nombre,
                    apellido: cliente.apellido,
                    dni: cliente.dni,
                    estado: cliente.estado
                }
            });
            return "Cliente eliminado";
        },

        // Método de prueba: sube un archivo de ejemplo a Vercel Blob y devuelve la URL
        testBlob: async () => {
            try {
                const { put } = await import('@vercel/blob');
                const { url } = await put('articles/backend.txt', 'Mi corazón soporta el peso abrumador de sus rigores', { access: 'public' });
                return url;
            } catch (error) {
                console.error('Error subiendo a Vercel Blob:', error);
                throw new Error('No se pudo subir el archivo de prueba');
            }
        },

        crearEventoAgenda: async (_, { input }, ctx) => {
            const normalizedInput = {
                ...input,
                date: normalizeDateInput(input.date),
                time: normalizeTimeInput(input.time)
            };

            try {
                const nuevoEvento = new AgendaEvent({
                    ...normalizedInput,
                    usuario: ctx && ctx.usuario ? ctx.usuario.id : undefined
                });
                await nuevoEvento.save();

                const now = new Date();
                const submittedAt = now.toISOString().slice(0, 19).replace('T', ' ');
                const eventoId = String(nuevoEvento._id);
                console.log('ID DEL EVENTO$$$$$$$$$$$$$$:', eventoId);

                const usuarioId = ctx && ctx.usuario && ctx.usuario.id
                    ? String(ctx.usuario.id)
                    : null;

                const payload = {
                    action: 'create',
                    id: eventoId,
                    mongoId: eventoId,
                    eventoId,
                    titulo: normalizedInput.title,
                    descripcion: normalizedInput.description,
                    fecha: normalizeAgendaWebhookDate(normalizedInput.date),
                    hora: normalizeAgendaWebhookTime(normalizedInput.time),
                    ubicacion: normalizedInput.location,
                    cliente: normalizedInput.client,
                    tipo: normalizedInput.type,
                    usuarioId,
                    submittedAt
                };
                console.log('|||||| ID DE MONGO:', payload.mongoId);

                try {
                    const res = await postAgendaWebhook(payload);
                    if (res.status >= 400) {
                        console.error('Webhook error:', res.status, res.body);
                    }
                } catch (err) {
                    console.error('Webhook request failed:', err);
                }

                await registrarActividad({
                    ctx,
                    accion: 'crear',
                    entidad: 'agenda',
                    entidadId: eventoId,
                    detalle: {
                        titulo: normalizedInput.title,
                        fecha: normalizeAgendaWebhookDate(normalizedInput.date),
                        hora: normalizeAgendaWebhookTime(normalizedInput.time),
                        cliente: normalizedInput.client,
                        tipo: normalizedInput.type
                    }
                });

                return {
                    title: normalizedInput.title,
                    description: normalizedInput.description,
                    date: normalizedInput.date,
                    time: normalizedInput.time,
                    location: normalizedInput.location,
                    client: normalizedInput.client,
                    type: normalizedInput.type,
                    submittedAt,
                    usuario: ctx && ctx.usuario ? ctx.usuario.id : null
                };
            } catch (error) {
                console.log(error);
                throw new Error('No se pudo crear el evento');
            }
        },

        editarEventoAgenda: async (_, { id, input }, ctx) => {
            const normalizedInput = {
                ...input,
                date: normalizeDateInput(input.date),
                time: normalizeTimeInput(input.time)
            };

            try {
                const eventoActualizado = await AgendaEvent.findByIdAndUpdate(
                    id,
                    { ...normalizedInput },
                    { new: true, runValidators: true }
                );

                if (!eventoActualizado) {
                    throw new Error('Evento no encontrado');
                }

                const submittedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
                const eventoId = String(eventoActualizado._id);
                const usuarioId = ctx && ctx.usuario && ctx.usuario.id
                    ? String(ctx.usuario.id)
                    : eventoActualizado.usuario
                        ? String(eventoActualizado.usuario)
                        : null;

                const payload = {
                    action: 'update',
                    id: eventoId,
                    mongoId: eventoId,
                    eventoId,
                    titulo: normalizedInput.title,
                    descripcion: normalizedInput.description,
                    fecha: normalizeAgendaWebhookDate(normalizedInput.date),
                    hora: normalizeAgendaWebhookTime(normalizedInput.time),
                    ubicacion: normalizedInput.location,
                    cliente: normalizedInput.client,
                    tipo: normalizedInput.type,
                    usuarioId,
                    submittedAt
                };
                //console.log('|||||| payload:', payload);

                try {
                    const res = await postAgendaWebhook(payload);
                    if (res.status >= 400) {
                        console.error('Webhook error:', res.status, res.body);
                    }
                } catch (err) {
                    console.error('Webhook request failed:', err);
                }

                await registrarActividad({
                    ctx,
                    accion: 'editar',
                    entidad: 'agenda',
                    entidadId: eventoId,
                    detalle: {
                        titulo: normalizedInput.title,
                        fecha: normalizeAgendaWebhookDate(normalizedInput.date),
                        hora: normalizeAgendaWebhookTime(normalizedInput.time),
                        cliente: normalizedInput.client,
                        tipo: normalizedInput.type
                    }
                });

                return {
                    title: eventoActualizado.title,
                    description: eventoActualizado.description,
                    date: eventoActualizado.date,
                    time: eventoActualizado.time,
                    location: eventoActualizado.location,
                    client: eventoActualizado.client,
                    type: eventoActualizado.type,
                    submittedAt,
                    usuario: eventoActualizado.usuario ? String(eventoActualizado.usuario) : null
                };
            } catch (error) {
                console.log(error);
                throw new Error(error.message || 'No se pudo editar el evento');
            }
        },

        eliminarEventoAgenda: async (_, { id }, ctx) => {
            try {
                const evento = await AgendaEvent.findById(id);

                if (!evento) {
                    throw new Error('Evento no encontrado');
                }

                const eventoId = String(evento._id);
                const usuarioId = ctx && ctx.usuario && ctx.usuario.id
                    ? String(ctx.usuario.id)
                    : evento.usuario
                        ? String(evento.usuario)
                        : null;
                const submittedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

                await AgendaEvent.findByIdAndDelete(id);

                const payload = {
                    action: 'delete',
                    id: eventoId,
                    mongoId: eventoId,
                    eventoId,
                    usuarioId,
                    submittedAt
                };
                console.log('|||||| payload:', payload);

                try {
                    const res = await postAgendaWebhook(payload);
                    if (res.status >= 400) {
                        console.error('Webhook error:', res.status, res.body);
                    }
                } catch (err) {
                    console.error('Webhook request failed:', err);
                }

                await registrarActividad({
                    ctx,
                    accion: 'eliminar',
                    entidad: 'agenda',
                    entidadId: eventoId,
                    detalle: {
                        titulo: evento.title,
                        fecha: normalizeAgendaWebhookDate(evento.date),
                        hora: normalizeAgendaWebhookTime(evento.time),
                        cliente: evento.client,
                        tipo: evento.type
                    }
                });

                return 'Evento eliminado';
            } catch (error) {
                console.log(error);
                throw new Error(error.message || 'No se pudo eliminar el evento');
            }
        }
    }
}

module.exports = resolvers;


