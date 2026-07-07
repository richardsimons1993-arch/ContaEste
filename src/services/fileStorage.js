const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const deleteRemoteFile = (invoicePath) => {
    return new Promise((resolve) => {
        if (!invoicePath) return resolve(true);

        const isWindows = process.platform === 'win32';
        if (isWindows) {
            if (fs.existsSync(invoicePath)) {
                fs.unlink(invoicePath, (err) => {
                    if (err) {
                        console.error('Error al eliminar archivo local:', err);
                    } else {
                        console.log('✅ Archivo local eliminado:', invoicePath);
                    }
                    resolve(true);
                });
            } else {
                resolve(true);
            }
        } else {
            const rcloneConfigPath = '/home/administrador/.config/rclone/rclone.conf';
            
            const runRclone = (args) => {
                return new Promise((res, rej) => {
                    const argsWithConfig = [...args];
                    if (fs.existsSync(rcloneConfigPath)) {
                        argsWithConfig.push('--config', rcloneConfigPath);
                    }
                    execFile('/usr/bin/rclone', argsWithConfig, (err, stdout, stderr) => {
                        if (err) {
                            rej({ err, stderr });
                        } else {
                            res(stdout);
                        }
                    });
                });
            };

            runRclone(['deletefile', invoicePath])
                .then(() => {
                    console.log('✅ Archivo eliminado con deletefile:', invoicePath);
                    resolve(true);
                })
                .catch((errorInfo) => {
                    console.warn('⚠️ Falló deletefile, intentando delete con --include...', errorInfo.err ? errorInfo.err.message : '');
                    
                    const lastSlashIndex = invoicePath.lastIndexOf('/');
                    if (lastSlashIndex !== -1) {
                        const dirPath = invoicePath.substring(0, lastSlashIndex);
                        const fileName = invoicePath.substring(lastSlashIndex + 1);
                        
                        runRclone(['delete', dirPath, '--include', fileName])
                            .then(() => {
                                console.log('✅ Archivo eliminado con delete --include:', invoicePath);
                                resolve(true);
                            })
                            .catch((fallbackErr) => {
                                console.error('❌ Falló también el método fallback de eliminación:', fallbackErr.err ? fallbackErr.err.message : '');
                                resolve(false);
                            });
                    } else {
                        resolve(false);
                    }
                });
        }
    });
};

module.exports = {
    deleteRemoteFile
};
