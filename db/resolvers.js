const Usuario = require('../models/Usuario');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Cliente = require('../models/Cliente');
const nodemailer = require('nodemailer');
require('dotenv').config();

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
                if (ctx.usuario.rol === 'admin') {
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
            if(cliente.vendedor.toString() !== ctx.usuario.id && ctx.usuario.rol !== 'admin'){
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
                const usuarios = await Usuario.find({});
                
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
            
            // Verificar si el usuario existe
            const usuario = await Usuario.findOne({email});
            if(!usuario){
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

                return "Se ha enviado un email con las instrucciones";
                
            } catch (error) {
                console.log(error);
                throw new Error('Error al enviar el email');
            }
        }, 
        updatePassword: async (_, { input }) => {
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

                return "Contraseña actualizada correctamente";
            } catch (error) {
                throw new Error('Token inválido o expirado');
            }
        },
        nuevoCliente: async (_, {input}, ctx) => {
            /*Verificar si el cliente ya está registrado
            const {email} = input;
            const cliente = await Cliente.findOne({email});
            if(cliente){
                throw new Error('Ese cliente ya está registrado');
            } */
           
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
        }
    }
}

module.exports = resolvers;

