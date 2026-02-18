const mongoose = require('mongoose');

const AgendaEventSchema = mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            trim: true
        },
        date: {
            type: String,
            required: true
        },
        time: {
            type: String,
            required: true
        },
        location: {
            type: String,
            trim: true
        },
        client: {
            type: String,
            trim: true
        },
        type: {
            type: String,
            enum: ['meeting', 'call', 'deadline', 'other'],
            default: 'meeting'
        },
        usuario: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Usuario',
            required: false
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('AgendaEvent', AgendaEventSchema);
