import { cartService } from '../services/cart.service.js';

export const cartController = {
  async getMyCart(req, res) {
    const result = await cartService.getMyCart(req.authId);
    res.json(result);
  },

  async addItem(req, res) {
    const result = await cartService.addItem(req.authId, req.body);
    res.status(201).json(result);
  },

  async updateItemQuantity(req, res) {
    const result = await cartService.updateItemQuantity(
      req.authId,
      req.params.productId,
      req.body.quantity,
    );
    res.json(result);
  },

  async removeItem(req, res) {
    const result = await cartService.removeItem(
      req.authId,
      req.params.productId,
    );
    res.json(result);
  },

  async clearCart(req, res) {
    const result = await cartService.clearCart(req.authId);
    res.json(result);
  },
};
