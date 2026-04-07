const fs = require('fs');
const pdf = require('pdf-parse');

const dataBuffer = fs.readFileSync('C:\\Users\\Richard\\Desktop\\INO-2026-01 WiFi Santa Rosa 455.pdf');

pdf(dataBuffer).then(function(data) {
    console.log(data.text);
}).catch(function(error){
    console.error("Error al leer el PDF:", error);
});
