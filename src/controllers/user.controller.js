import { userService } from '../services/user.service.js';

export const userController = {
  async getMe(req, res) {
    const user = await userService.getMe(req.user.toJSON());
    res.json(user);
  },

  async updateMe(req, res) {
    const user = await userService.updateMe(req.authId, req.body);
    res.json(user);
  },

  async deleteMe(req, res) {
    const result = await userService.softDeleteSelf(req.authId);
    res.json(result);
  },

  async listUsers(req, res) {
    const result = await userService.listUsers(req.query);
    res.json(result);
  },

  async getUserById(req, res) {
    const user = await userService.getUserById(req.params.id);
    res.json(user);
  },

  async deleteUser(req, res) {
    const result = await userService.softDeleteUser(req.params.id);
    res.json(result);
  },

  async updateUserRole(req, res) {
    const user = await userService.updateUserRole(
      req.authId,
      req.params.id,
      req.body.role,
    );
    res.json(user);
  },

  async suspendUser(req, res) {
    const result = await userService.suspendUser(req.authId, req.params.id);
    res.json(result);
  },

  async unsuspendUser(req, res) {
    const result = await userService.unsuspendUser(req.params.id);
    res.json(result);
  },

  async restoreUser(req, res) {
    const result = await userService.restoreUser(req.params.id);
    res.json(result);
  },
};
