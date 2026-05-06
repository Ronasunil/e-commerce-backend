import { orderService } from '../services/order.service.js';

export const orderController = {
  async list(req, res) {
    const orders = await orderService.list(req.query);
    res.json(orders);
  },

  async getById(req, res) {
    const order = await orderService.getById(req.params.id);
    res.json(order);
  },

  async create(req, res) {
    const order = await orderService.create(req.body);
    res.status(201).json(order);
  },

  async update(req, res) {
    const order = await orderService.update(req.params.id, req.body);
    res.json(order);
  },

  async remove(req, res) {
    await orderService.remove(req.params.id);
    res.status(204).send();
  },
};
