import { userService } from '../services/user.service.js';

export const userController = {
  async list(req, res) {
    const users = await userService.list();
    res.json(users);
  },

  async getById(req, res) {
    const user = await userService.getById(req.params.id);
    res.json(user);
  },

  async create(req, res) {
    const user = await userService.create(req.body);
    res.status(201).json(user);
  },

  async update(req, res) {
    const user = await userService.update(req.params.id, req.body);
    res.json(user);
  },

  async remove(req, res) {
    await userService.remove(req.params.id);
    res.status(204).send();
  },
};
