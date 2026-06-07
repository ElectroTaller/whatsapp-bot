const aiGemini = require('./ai_gemini.js');
const utils = require('./utils.js');

module.exports = {
    async handleAdminCommands(msg, clientInstance, texto, sender, contactNum, humanTakenOver, adminIds, adminAire, adminAuto) {
        
        // ── Comando: saludar NÚMERO ───────────────────────────────────────────
        if (texto.startsWith('saludar ') || texto.startsWith('saluda ')) {
            const rawNumber = texto.replace(/^saludar?\s*/i, '');
            const targetNumberFormatted = utils.formatearTelefono(rawNumber).replace('+', '');
            
            if (targetNumberFormatted.length > 5) {
                const targetId = `${targetNumberFormatted}@c.us`;
                const saludoMsg = `¡Hola! 👋 Te escribimos de *ElectroTaller* (mensaje automático del bot).\nAquí te compartimos nuestra información de contacto para que puedas guardar nuestro número y realizar tus consultas de forma rápida.\n\n🕒 *Horarios:*\nLunes a Viernes de 8:00 AM - 12:00 PM y 1:00 PM - 6:00 PM\n\n📍 *Ubicación (Waze):*\nhttps://waze.com/ul/hd1x7qcpc7\n\nQuedamos a la orden para apoyarte con tus equipos.`;
                try {
                    await clientInstance.sendMessage(targetId, saludoMsg);
                    return msg.reply(`✅ Saludo enviado exitosamente a ${targetNumberFormatted}`);
                } catch (err) {
                    return msg.reply(`❌ Error al enviar saludo a ${targetNumberFormatted}: ${err.message}`);
                }
            }
            return msg.reply('❌ Formato incorrecto. Usa: *saludar 6246-0158*');
        }

        // ── Comando: tomar NÚMERO ─────────────────────────────────────────────
        if (texto.startsWith('tomar ')) {
            const rawNumber = texto.replace(/^tomar\s*/i, '');
            const targetNumberFormatted = utils.formatearTelefono(rawNumber).replace('+', '');
            if (targetNumberFormatted.length > 5) {
                const targetId = `${targetNumberFormatted}@c.us`;
                humanTakenOver[targetId] = true;
                console.log(`🙋 [ADMIN] Toma de control activada para ${targetId}`);
                return msg.reply(`✅ *Modo humano activado* para el cliente *${targetNumberFormatted}*.\nEl bot está en pausa para ese chat. Cuando termines, escribe:\n👉 *liberar ${targetNumberFormatted}*`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *tomar 5071234567*');
        }

        // ── Comando: liberar NÚMERO ───────────────────────────────────────────
        if (texto.startsWith('liberar ')) {
            const rawNumber = texto.replace(/^liberar\s*/i, '');
            const targetNumberFormatted = utils.formatearTelefono(rawNumber).replace('+', '');
            if (targetNumberFormatted.length > 5) {
                const targetId = `${targetNumberFormatted}@c.us`;
                delete humanTakenOver[targetId];
                console.log(`🤖 [ADMIN] Bot reactivado para ${targetId}`);
                return msg.reply(`✅ *Bot reactivado* para el cliente *${targetNumberFormatted}*. ElectroBot volverá a responder automáticamente.`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *liberar 5071234567*');
        }

        // ── Comando: responder NÚMERO mensaje ─────────────────────────────────
        if (texto.startsWith('responder ')) {
            // Ejemplo: responder +507 6246-0158 Hola cómo estás
            // Con Regex capturamos primero el bloque de números y símbolos y luego el texto
            const matchResponder = texto.match(/^responder\s*([\+\d\s\-]+)(.+)/i);
            if (matchResponder) {
                const targetNumberFormatted = utils.formatearTelefono(matchResponder[1]).replace('+', '');
                const mensajeOriginal = matchResponder[2].trim();
                
                if (targetNumberFormatted.length > 5 && mensajeOriginal.length > 0) {
                    const targetId = `${targetNumberFormatted}@c.us`;
                    let mensajeFinal = mensajeOriginal;

                    // Corregir ortografía y gramática con Gemini
                    const textoCorregido = await aiGemini.corregirGramatica(mensajeOriginal);
                    if (textoCorregido && textoCorregido.length > 0) {
                        mensajeFinal = textoCorregido;
                        console.log(`[CORRECTOR] Original: "${mensajeOriginal}" → Corregido: "${textoCorregido}"`);
                    }

                    try {
                        await clientInstance.sendMessage(targetId, mensajeFinal);
                        const notaCorreccion = mensajeFinal !== mensajeOriginal
                            ? `\n\n_✏️ Texto corregido automáticamente por el bot._`
                            : '';
                        return msg.reply(`✅ Mensaje enviado a *${targetNumberFormatted}*:\n"${mensajeFinal}"${notaCorreccion}`);
                    } catch (err) {
                        return msg.reply(`❌ Error al enviar mensaje a ${targetNumberFormatted}: ${err.message}`);
                    }
                }
            }
            return msg.reply('❌ Formato incorrecto. Usa: *responder +50761234567 Tu mensaje aquí*');
        }

        // ── Comando: chats ────────────────────────────────────────────────────
        if (texto === 'chats' || texto === 'activos') {
            const activos = Object.keys(humanTakenOver);
            if (activos.length === 0) {
                return msg.reply('ℹ️ No hay chats bajo control humano en este momento. El bot está respondiendo a todos.');
            }
            const lista = activos.map(id => `• ${id.replace('@c.us', '')}`).join('\n');
            return msg.reply(`🙋 *Chats bajo control humano (bot pausado):*\n${lista}\n\nPara reactivar el bot en uno de ellos escribe: *liberar NÚMERO*`);
        }
        
        return false; // Not handled
    }
};
