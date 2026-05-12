import { authService } from '../services/auth.service.js';

export const authController = {
  async register(req, res) {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  },

  async verifyOtp(req, res) {
    const result = await authService.verifyOtp(req.body);
    res.json(result);
  },

  async resendOtp(req, res) {
    const result = await authService.resendOtp(req.body);
    res.json(result);
  },

  async login(req, res) {
    const result = await authService.login(req.body);
    res.json(result);
  },

  async logout(req, res) {
    const result = await authService.logout();
    res.json(result);
  },

  async forgotPassword(req, res) {
    const result = await authService.forgotPassword(req.body);
    res.json(result);
  },

  async resetPassword(req, res) {
    const result = await authService.resetPassword(req.body);
    res.json(result);
  },

  async changePassword(req, res) {
    const result = await authService.changePassword({
      authId: req.authId,
      ...req.body,
    });
    res.json(result);
  },
};
