import { productService } from '../services/product.service.js';

export const productController = {
  // -- Public ----------------------------------------------------------------

  async publicList(req, res) {
    const result = await productService.listPublic(req.query);
    res.json(result);
  },

  async publicGetById(req, res) {
    const product = await productService.getPublicById(req.params.id);
    res.json(product);
  },

  // -- Admin -----------------------------------------------------------------

  async list(req, res) {
    const result = await productService.listAll(req.query);
    res.json(result);
  },

  async getById(req, res) {
    const product = await productService.getAnyById(req.params.id);
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
    const result = await productService.remove(req.params.id);
    res.json(result);
  },

  async restore(req, res) {
    const result = await productService.restore(req.params.id);
    res.json(result);
  },
};
