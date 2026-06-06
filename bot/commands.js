const aiGemini = require('./ai_gemini.js');

module.exports = {
    async handleAdminCommands(msg, clientInstance, texto, sender, contactNum, humanTakenOver, adminIds, adminAire, adminAuto) {
        const matchSaludo = texto.match(/^saludar?\s*(\+?\d+)/);
        if (matchSaludo) {
            let targetNumber = matchSaludo[1].replace(/\D/g, '');
            if (targetNumber.length > 0) {
                if (targetNumber.length === 8 || targetNumber.length === 7) targetNumber = '507' + targetNumber;
                const targetId = `${targetNumber}@c.us`;
                const saludoMsg = `¡Hola! 👋 Te escribimos de *ElectroTaller* (mensaje automático del bot).\nAquí te compartimos nuestra información de contacto para que puedas guardar nuestro número y realizar tus consultas de forma rápida.\n\n🕒 *Horarios:*\nLunes a Viernes de 8:00 AM - 12:00 PM y 1:00 PM - 6:00 PM\n\n📍 *Ubicación (Waze):*\nhttps://waze.com/ul/hd1x7qcpc7\n\nQuedamos a la orden para apoyarte con tus equipos.`;
                try {
                    await clientInstance.sendMessage(targetId, saludoMsg);
                    return msg.reply(`✅ Saludo enviado exitosamente a ${targetNumber}`);
                } catch (err) {
                    return msg.reply(`❌ Error al enviar saludo a ${targetNumber}: ${err.message}`);
                }
            }
        }

        // ── Comando: tomar NÚMERO — pausa el bot para ese cliente ──────────────────
        if (texto.startsWith('tomar ')) {
            let targetNumber = texto.split(' ')[1]?.replace(/\D/g, '') || '';
            if (targetNumber.length === 8) targetNumber = '507' + targetNumber;
            if (targetNumber.length > 0) {
                const targetId = `${targetNumber}@c.us`;
                humanTakenOver[targetId] = true;
                console.log(`🙋 [ADMIN] Toma de control activada para ${targetId}`);
                return msg.reply(`✅ *Modo humano activado* para el cliente *${targetNumber}*.\nEl bot está en pausa para ese chat. Cuando termines, escribe:\n👉 *liberar ${targetNumber}*`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *tomar 5071234567*');
        }

        // ── Comando: liberar NÚMERO — reactiva el bot para ese cliente ─────────────
        if (texto.startsWith('liberar ')) {
            let targetNumber = texto.split(' ')[1]?.replace(/\D/g, '') || '';
            if (targetNumber.length === 8) targetNumber = '507' + targetNumber;
            if (targetNumber.length > 0) {
                const targetId = `${targetNumber}@c.us`;
                delete humanTakenOver[targetId];
                console.log(`🤖 [ADMIN] Bot reactivado para ${targetId}`);
                return msg.reply(`✅ *Bot reactivado* para el cliente *${targetNumber}*. ElectroBot volverá a responder automáticamente.`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *liberar 5071234567*');
        }

        // ── Comando: responder NÚMERO mensaje — envía mensaje al cliente con corrección ortográfica ──
        if (texto.startsWith('responder ')) {
            const partes = msg.body.trim().split(' ');
            if (partes.length >= 3) {
                let targetNumber = partes[1].replace(/\D/g, '');
                if (targetNumber.length === 8 || targetNumber.length === 7) targetNumber = '507' + targetNumber;
                const mensajeOriginal = partes.slice(2).join(' ');
                if (targetNumber.length > 0 && mensajeOriginal.length > 0) {
                    const targetId = `${targetNumber}@c.us`;
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
                        return msg.reply(`✅ Mensaje enviado a *${targetNumber}*:\n"${mensajeFinal}"${notaCorreccion}`);
                    } catch (err) {
                        return msg.reply(`❌ Error al enviar mensaje a ${targetNumber}: ${err.message}`);
                    }
                }
            }
            return msg.reply('❌ Formato incorrecto. Usa: *responder +50761234567 Tu mensaje aquí*');
        }

        // ── Comando: chats — lista los chats bajo control humano ──────────────────
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
