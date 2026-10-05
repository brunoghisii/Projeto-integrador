import { Router } from 'express';
import * as authPacienteController from '../controllers/authPacienteController.js';

const router = Router();

router.post('/register', authPacienteController.register);
router.post('/login', authPacienteController.login);
router.post('/logout', authPacienteController.logout);
router.post('/recuperar-senha', authPacienteController.recuperarSenha);
router.post('/redefinir-senha', authPacienteController.redefinirSenha);

export default router;
