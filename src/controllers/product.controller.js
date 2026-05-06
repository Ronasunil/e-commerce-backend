import { productService } from '../services/product.service.js';

export const productController = {
  async list(req, res) {
    const products = await productService.list(req.query);
    res.json(products);
  },

  async getById(req, res) {
    const product = await productService.getById(req.params.id);
    res.json(product);
  },

  async create(req, res) {
    const product = await productService.create(req.body);
    res.status(201).json(product);
  },

  async update(req, res) {
    const product = await productService.update(req.params.id, req.body);
    res.json(product);
  },

  async remove(req, res) {
    await productService.remove(req.params.id);
    res.status(204).send();
  },
};
