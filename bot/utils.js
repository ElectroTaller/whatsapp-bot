module.exports = {
    normalizarTextoBusqueda: function(txt) {
        if (!txt) return '';
        return txt.toUpperCase()
            .trim()
            .replace(/^(ORDEN DE SERVICIO|ORDEN DE TRABAJO|ORDEN|ORD|NÚMERO|NUMERO|NUM|N°|N_)+/g, '')
            .replace(/^[\s\-_]+|[\s\-_]+$/g, '')
            .replace(/[\s\-_]+/g, '');
    },
    obtenerDescripcionEquipo: function(order) {
        let equipo = order.deviceType || 'Equipo';
        let extras = [];
        if (order.vehicleData) {
            if (order.vehicleData.brand) extras.push(order.vehicleData.brand);
            if (order.vehicleData.model) extras.push(order.vehicleData.model);
        }
        if (order.acData) {
            if (order.acData.brand) extras.push(order.acData.brand);
            if (order.acData.model) extras.push(order.acData.model);
        }
        if (order.brand && !extras.includes(order.brand)) extras.push(order.brand);
        if (order.model && !extras.includes(order.model)) extras.push(order.model);
        if (extras.length > 0) {
            equipo += ` ${extras.join(' ')}`;
        }
        if (order.deviceDesc) {
            equipo += ` (${order.deviceDesc})`;
        }
        return equipo.trim();
    },
    formatearTelefono: function(num) {
        if (!num) return '';
        const digits = num.replace(/\D/g, '');
        if (digits.length >= 10) return `+${digits}`;
        if (digits.length === 8) return `+507${digits}`;
        if (digits.length === 7) return `+507${digits}`;
        if (digits.length === 9 && digits.startsWith('507')) return `+${digits}`;
        return `+${digits}`;
    }
};
